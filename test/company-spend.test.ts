import { describe, expect, it } from 'vitest';
import { ended, rig } from './company-kit.ts';

const costOf = (view: { people: { id: string; cost: number }[] }, id: string) => view.people.find((p) => p.id === id)?.cost;

describe('what a company has spent, across a restart', () => {
  it('reads the same after a reopen, including a turn the transcripts priced and the company never did', async () => {
    const { company, desks, reopen } = await rig({ running: true });
    desks().events.turn('ui-designer', ended('Palette done.'));
    // A second turn is under way when the hub stops: only the transcripts know its $0.04.
    company.noteSpend(new Map([['ui-designer', 0.05]]));
    expect(costOf(company.view(), 'ui-designer')).toBeCloseTo(0.05, 6);
    expect(company.lobbyEntry().spend).toBeCloseTo(0.05, 6);
    await company.close();

    const again = reopen();
    const view = again.view();
    expect(costOf(view, 'ui-designer')).toBeCloseTo(0.05, 6);
    expect(again.lobbyEntry().spend).toBeCloseTo(0.05, 6);
    expect(view.spend.byPerson.find((p) => p.person === 'ui-designer')?.all).toBeCloseTo(0.05, 6);
    await again.close();
  });

  it('follows a later transcript read, and the turn that ends prices it without counting it twice', async () => {
    const { company, desks, reopen } = await rig({ running: true });
    desks().events.turn('ui-designer', ended('Palette done.'));
    company.noteSpend(new Map([['ui-designer', 0.05]]));
    await company.close();

    const again = reopen();
    // The desk is back and its transcript is read again: the same history, a little more.
    again.noteSpend(new Map([['ui-designer', 0.05]]));
    expect(costOf(again.view(), 'ui-designer')).toBeCloseTo(0.05, 6);
    again.noteSpend(new Map([['ui-designer', 0.07]]));
    expect(costOf(again.view(), 'ui-designer')).toBeCloseTo(0.07, 6);
    // The turn ends at 6 cents: the company's price replaces what the transcripts showed of it.
    desks().events.turn('ui-designer', { ...ended('Streak card done.'), costUsd: 0.06 });
    expect(costOf(again.view(), 'ui-designer')).toBeCloseTo(0.07, 6);
    expect(again.lobbyEntry().spend).toBeCloseTo(0.07, 6);
    await again.close();
  });

  it('writes nothing down for what the company already priced, or for a few mills', async () => {
    const { company, desks } = await rig({ running: true });
    desks().events.turn('ui-designer', ended('Palette done.'));
    company.noteSpend(new Map([['ui-designer', 0.01], ['ghost; rm -rf', 5], ['ceo', Number.NaN]]));
    company.noteSpend(new Map([['ui-designer', 0.012]]));
    expect(costOf(company.view(), 'ui-designer')).toBeCloseTo(0.01, 6);
    expect(costOf(company.view(), 'ceo')).toBe(0);
  });
});
