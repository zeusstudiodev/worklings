// Trusted needs the stakeholder's yes in the inbox, however someone else gets a person there: by talking (the CEO's
// change_settings), by clearing their own leash in a Trusted room, or by a hire, a rehire or a move into one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Rig, rig, STAKEHOLDER } from './company-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const leashOf = (r: Rig, person: string): string => r.company.view().steering?.people[person]?.leash ?? 'missing';
const open = (r: Rig) => r.company.view().questions.filter((q) => !q.answer && !q.withdrawn);
const said = (r: Rig) => {
  const m = r.company.say('ceo', 'Thanks, carry on.', { typed: true });
  vi.advanceTimersByTime(1_000);
  return m;
};

async function trustedDesignRoom(): Promise<Rig> {
  const r = await rig({ running: true, planApproval: 'off' });
  r.company.changeSettings(STAKEHOLDER, { leash: { room: 'design', leash: 'trusted' }, cites: [] });
  r.company.changeSettings(STAKEHOLDER, { leash: { person: 'ui-designer', leash: 'default' }, cites: [] });
  vi.advanceTimersByTime(1_000);
  return r;
}

describe('Trusted only with the stakeholder yes', () => {
  it('clearing a leash in a Trusted room asks the inbox first', async () => {
    const r = await trustedDesignRoom();
    const word = said(r);
    r.company.changeSettings('ceo', { leash: { person: 'ui-designer', leash: null }, cites: [word.id] });
    expect(leashOf(r, 'ui-designer')).toBe('default');
    expect(open(r).map((q) => q.text)).toEqual([expect.stringMatching(/Kai.* Trusted/s)]);
    // The yes makes it so.
    const q = open(r)[0];
    r.company.answer(q?.id ?? '', { option: 0, text: '' });
    vi.advanceTimersByTime(60_000);
    expect(leashOf(r, 'ui-designer')).toBe('trusted');
  });

  it('a no keeps the leash', async () => {
    const r = await trustedDesignRoom();
    const word = said(r);
    r.company.changeSettings('ceo', { leash: { person: 'ui-designer', leash: null }, cites: [word.id] });
    r.company.answer(open(r)[0]?.id ?? '', { option: 1, text: '' });
    vi.advanceTimersByTime(60_000);
    expect(leashOf(r, 'ui-designer')).toBe('default');
  });

  it('the stakeholder clearing it themselves needs no question', async () => {
    const r = await trustedDesignRoom();
    r.company.changeSettings(STAKEHOLDER, { leash: { person: 'ui-designer', leash: null }, cites: [] });
    expect(leashOf(r, 'ui-designer')).toBe('trusted');
    expect(open(r)).toEqual([]);
  });

  it('a move into a Trusted room by the CEO asks first', async () => {
    const r = await rig({ running: true, planApproval: 'off' });
    r.company.changeSettings(STAKEHOLDER, { leash: { room: 'engineering', leash: 'trusted' }, cites: [] });
    expect(leashOf(r, 'ui-designer')).toBe('default');
    expect(r.company.move('ceo', { role: 'ui-designer', room: 'engineering', reportsTo: null }).ok).toBe(true);
    expect(leashOf(r, 'ui-designer')).toBe('default');
    expect(open(r)).toHaveLength(1);
    // The stakeholder's own move is their yes.
    expect(r.company.move(STAKEHOLDER, { role: 'ux-designer', room: 'engineering', reportsTo: null }).ok).toBe(true);
    expect(leashOf(r, 'ux-designer')).toBe('trusted');
    expect(open(r)).toHaveLength(1);
  });

  it('a hire and a rehire into a Trusted room ask first', async () => {
    const r = await rig({ running: true, planApproval: 'off' });
    r.company.changeSettings(STAKEHOLDER, { leash: { room: 'design', leash: 'trusted' }, cites: [] });
    expect(r.company.hire('ceo', { role: 'copywriter', room: 'design', reportsTo: 'head-of-design', name: 'Lena', title: 'German copywriter' }).ok).toBe(true);
    expect(leashOf(r, 'copywriter')).toBe('default');
    expect(open(r)).toHaveLength(1);
    expect(r.company.fire('ceo', 'copywriter').ok).toBe(true);
    expect(r.company.rehire('ceo', 'copywriter').ok).toBe(true);
    expect(leashOf(r, 'copywriter')).toBe('default');
  });
});
