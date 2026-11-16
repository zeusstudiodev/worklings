import { describe, expect, it } from 'vitest';
import {
  changeOf,
  effortChoices,
  leashBadge,
  leashChoices,
  leashSource,
  leashWith,
  modelChoices,
  ownLeashes,
  ownLeashesLine,
  personDraft,
  roomChange,
  roomLeash,
  roomSavedLine,
  savedLine,
  steeringOf,
} from '../web/src/company/leash/leashModel.ts';
import { personSteering, steered } from './panels-steering-kit.ts';
import { company, studio } from './panels-work-kit.ts';

const snap = { studio };
const kai = () => company().people.find((p) => p.id === 'frontend-engineer')!;

/** Mina checks with you; engineering is trusted; Kai works at high effort. */
const leashed = () =>
  steered(
    {},
    {
      settings: { planApproval: 'before-work', leash: { people: { 'ui-designer': 'check' }, rooms: { engineering: 'trusted' } }, effort: { 'frontend-engineer': 'high' } },
      people: { 'ui-designer': personSteering('check', 'person'), 'frontend-engineer': personSteering('trusted', 'room', 'high'), ceo: personSteering('default', 'company') },
    },
  );

describe('the badge', () => {
  it('shows Checks with you and Trusted, and nothing for Default', () => {
    expect(leashBadge(personSteering('check', 'person'))).toEqual({ text: 'Checks with you', detail: 'Each new task waits in your inbox until you say start.' });
    expect(leashBadge(personSteering('trusted', 'room'))?.text).toBe('Trusted');
    expect(leashBadge(personSteering('default', 'company'))).toBeNull();
    expect(leashBadge(null)).toBeNull();
  });

  it("reads a person's leash from the view, or the company's default when the view says nothing", () => {
    expect(steeringOf(leashed(), 'ui-designer')).toEqual(personSteering('check', 'person'));
    expect(steeringOf(leashed(), 'qa-engineer')).toEqual(personSteering('default', 'company'));
    expect(steeringOf(company(), 'ui-designer')).toEqual(personSteering('default', 'company'));
    // An id like __proto__ is a key like any other, never the record's prototype.
    expect(steeringOf(leashed(), '__proto__')).toEqual(personSteering('default', 'company'));
  });

  it('says where a leash comes from', () => {
    expect(leashSource(snap, kai(), personSteering('trusted', 'room'))).toBe('From the engineering room.');
    expect(leashSource(snap, kai(), personSteering('check', 'person'))).toBe('Their own setting.');
    expect(leashSource(snap, kai(), personSteering('default', 'company'))).toBe("The company's default.");
  });
});

describe("a person's controls", () => {
  it('start from their own leash, model and effort', () => {
    expect(personDraft(leashed(), kai())).toEqual({ leash: 'room', model: 'sonnet', effort: 'high' });
    expect(personDraft(leashed(), { id: 'ui-designer', model: 'opus' })).toEqual({ leash: 'check', model: 'opus', effort: 'default' });
  });

  it("offer their room's leash first, saying what it is", () => {
    expect(leashChoices(leashed(), kai()).map((c) => c.label)).toEqual(['Same as their room (Trusted)', 'Checks with you', 'Default', 'Trusted']);
    expect(leashChoices(leashed(), { room: 'design' })[0]?.label).toBe('Same as the company');
    expect(leashWith(leashed(), kai(), { leash: 'room', model: 'sonnet', effort: 'default' })).toBe('trusted');
  });

  it("offer the models a role runs on, keeping a full model id they already have", () => {
    expect(modelChoices('sonnet').map((c) => c.value)).toEqual(['sonnet', 'opus', 'haiku']);
    expect(modelChoices('inherit').map((c) => c.value)).toEqual(['inherit', 'sonnet', 'opus', 'haiku']);
    expect(modelChoices('claude-sonnet-4-5').map((c) => c.value)).toEqual(['claude-sonnet-4-5', 'sonnet', 'opus', 'haiku']);
    expect(effortChoices().map((c) => c.label)).toEqual(["Claude Code's default", 'Low', 'Medium', 'High', 'Extra high', 'Max']);
  });

  it('send one change for what moved, null to clear their own, and the change that undoes it', () => {
    const before = { leash: 'room' as const, model: 'sonnet', effort: 'high' as const };
    const after = { leash: 'check' as const, model: 'opus', effort: 'default' as const };
    expect(changeOf('frontend-engineer', before, before)).toBeNull();
    expect(changeOf('frontend-engineer', before, after)).toEqual({
      leash: { person: 'frontend-engineer', leash: 'check' },
      model: { person: 'frontend-engineer', model: 'opus' },
      effort: { person: 'frontend-engineer', effort: null },
    });
    expect(changeOf('frontend-engineer', after, before)).toEqual({
      leash: { person: 'frontend-engineer', leash: null },
      model: { person: 'frontend-engineer', model: 'sonnet' },
      effort: { person: 'frontend-engineer', effort: 'high' },
    });
  });

  it('say what a save changed, and that model and effort wait for the next desk', () => {
    const before = { leash: 'room' as const, model: 'sonnet', effort: 'default' as const };
    expect(savedLine(leashed(), kai(), before, { ...before, leash: 'check' })).toBe('Kai checks with you before each new task now.');
    expect(savedLine(leashed(), kai(), { ...before, leash: 'check' }, before)).toBe('Kai is trusted with routine work in the project now.');
    expect(savedLine(leashed(), kai(), before, { ...before, model: 'opus', effort: 'max' })).toBe("Opus and max effort from Kai's next desk.");
  });
});

describe("a room's leash", () => {
  it('clears the room’s own for Default, so its people follow the company', () => {
    expect(roomChange('design', 'default')).toEqual({ leash: { room: 'design', leash: null } });
    expect(roomChange('design', 'trusted')).toEqual({ leash: { room: 'design', leash: 'trusted' } });
    expect(roomLeash(leashed(), 'engineering')).toBe('trusted');
    expect(roomLeash(leashed(), 'design')).toBeNull();
  });

  it('names the people in it who keep their own', () => {
    expect(ownLeashes(leashed(), 'design')).toEqual([{ id: 'ui-designer', name: 'Mina', leash: 'check' }]);
    expect(ownLeashesLine(ownLeashes(leashed(), 'design'))).toBe('Mina (checks with you) keeps a leash of their own.');
    expect(ownLeashesLine([])).toBeNull();
    expect(roomSavedLine(snap, 'design', 'trusted')).toBe('The design room is trusted now.');
  });
});
