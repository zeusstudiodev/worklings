// v0.3, portfolios: the store in the hub's folder, the roll-up a lobby card shows, and the hold a spent budget puts on
// each company's desks.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompanySummary, DeskControl, LobbyCompany } from '../src/core/company.ts';
import { holdable } from '../src/hub/hold.ts';
import { portfolioLine, rollUp } from '../src/studio/model.ts';
import { PortfolioStore } from '../src/studio/portfolios.ts';
import { tempDir } from './library-kit.ts';

const NAMES: Record<string, string> = { 'plant-pal': 'Plant Pal', 'corner-bakery': 'Corner Bakery', 'tool-api': 'Tool API' };
const known = (id: string) => NAMES[id] ?? null;

function summary(over: Partial<CompanySummary> = {}): CompanySummary {
  return {
    goal: 'A goal.', stage: 'working', milestones: { done: 1, planned: 3 }, tasks: { done: 4, planned: 10 }, achieved: [], working: [], needs: { count: 0, items: [] },
    spend: { spent: 2, budget: null }, preview: null, movedAt: null, checklist: null, ...over,
  };
}
function entry(id: string, over: Partial<LobbyCompany> = {}, s: Partial<CompanySummary> = {}): LobbyCompany {
  return { id, name: NAMES[id] ?? id, root: `/p/${id}`, phase: 'running', theme: 'office', people: [], working: 2, waiting: 0, needsYou: 0, pause: null, spend: 2, latest: null, problem: null, summary: summary(s), ...over };
}

describe('the portfolio store', () => {
  it('keeps a portfolio across a restart, with its companies, budget and brief', () => {
    const dir = tempDir('worklings-portfolios-');
    const store = new PortfolioStore(dir, { now: () => 5 });
    const p = store.create({ name: '  Client   work ', companies: ['plant-pal', 'corner-bakery'], budget: 50.456, brief: ' German first.\r\n' }, known);
    expect(p).toEqual({ id: 'p-client-work', name: 'Client work', companies: ['plant-pal', 'corner-bakery'], budget: 50.46, brief: 'German first.', createdAt: 5 });
    expect(new PortfolioStore(dir).all()).toEqual([p]);
    expect(new PortfolioStore(dir).of('corner-bakery')?.id).toBe('p-client-work');
  });

  it('puts a company in one portfolio at most, and says where it is', () => {
    const store = new PortfolioStore(tempDir('worklings-portfolios-'));
    store.create({ name: 'Client work', companies: ['plant-pal'] }, known);
    expect(() => store.create({ name: 'Side', companies: ['plant-pal'] }, known)).toThrow('Plant Pal is in the Client work portfolio already. Take it out there first.');
    const side = store.create({ name: 'Side', companies: ['tool-api'] }, known);
    expect(() => store.update(side.id, { companies: ['tool-api', 'plant-pal'] }, known)).toThrow('Plant Pal is in the Client work portfolio already.');
  });

  it('refuses a name, budget, brief or company it can not keep, in a sentence', () => {
    const store = new PortfolioStore(tempDir('worklings-portfolios-'));
    expect(() => store.create({ name: '' }, known)).toThrow('Give the portfolio a name.');
    expect(() => store.create({ name: 'x'.repeat(61) }, known)).toThrow('Keep the name to 60 characters.');
    expect(() => store.create({ name: 'A', budget: 0 }, known)).toThrow('A budget is a dollar amount from $0.01 to $1,000,000, or none.');
    expect(() => store.create({ name: 'A', budget: '5' }, known)).toThrow('A budget is a dollar amount');
    expect(() => store.create({ name: 'A', brief: 'b'.repeat(4001) }, known)).toThrow('Keep the shared brief to 4,000 characters.');
    expect(() => store.create({ name: 'A', companies: ['nowhere'] }, known)).toThrow("One of those companies isn't in the lobby any more.");
    expect(() => store.create({ name: 'A', companies: ['plant-pal', 'plant-pal'] }, known)).toThrow('names one company twice');
    expect(() => store.create({ name: 'A', companies: ['../x'] }, known)).toThrow("isn't a company's id");
    store.create({ name: 'Same' }, known);
    expect(() => store.create({ name: 'same' }, known)).toThrow("There's a portfolio called same already.");
    expect(store.all().map((p) => p.name)).toEqual(['Same']);
  });

  it('changes only the fields given, takes a budget off with null, and forgets a company that left the lobby', () => {
    const store = new PortfolioStore(tempDir('worklings-portfolios-'));
    const p = store.create({ name: 'Client work', companies: ['plant-pal', 'corner-bakery'], budget: 20 }, known);
    expect(store.update(p.id, { brief: 'Bilingual.' }, known)).toMatchObject({ budget: 20, brief: 'Bilingual.', companies: ['plant-pal', 'corner-bakery'] });
    expect(store.update(p.id, { budget: null }, known).budget).toBeNull();
    store.forget('plant-pal');
    expect(store.get(p.id)?.companies).toEqual(['corner-bakery']);
    expect(store.remove(p.id).name).toBe('Client work');
    expect(() => store.remove(p.id)).toThrow("That portfolio isn't in the lobby any more.");
  });

  it('reads a hand-edited file defensively: a company in two portfolios stays in the first, a broken entry is dropped', () => {
    const dir = tempDir('worklings-portfolios-');
    writeFileSync(
      join(dir, 'portfolios.json'),
      JSON.stringify({ portfolios: [{ id: 'p-a', name: 'A', companies: ['plant-pal'], budget: null, brief: null, createdAt: 1 }, { id: 'p-b', name: 'B', companies: ['plant-pal', 'tool-api'], budget: -4, brief: null, createdAt: 1 }, { id: '__proto__', name: 'C', companies: [], createdAt: 1 }, { id: 'p-d', name: 'D', companies: ['plant-pal', 'tool-api'], budget: null, brief: null, createdAt: 2 }] }),
    );
    const store = new PortfolioStore(dir);
    expect(store.all().map((p) => [p.id, p.companies])).toEqual([
      ['p-a', ['plant-pal']],
      ['p-d', ['tool-api']],
    ]);
    // Nothing is written until something changes.
    expect(readFileSync(join(dir, 'portfolios.json'), 'utf8')).toContain('"p-b"');
  });
});

describe("a portfolio's card", () => {
  const p = { id: 'p-client-work', name: 'Client work', companies: ['plant-pal', 'corner-bakery', 'tool-api'], budget: 20, brief: null, createdAt: 1 };

  it('rolls its companies up: one line, progress, spend against the budget and what waits on you', () => {
    const view = rollUp(p, [
      entry('plant-pal', { needsYou: 2 }, { stage: 'waiting', needs: { count: 2, items: [{ company: 'plant-pal', kind: 'question', text: 'Which pickup window?', from: 'Mina', at: 30, target: { panel: 'inbox', item: 'q-1' } }] } }),
      entry('corner-bakery', {}, { stage: 'working', spend: { spent: 3.5, budget: null } }),
      entry('tool-api', { working: 0 }, { stage: 'done', tasks: { done: 6, planned: 6 }, milestones: { done: 2, planned: 2 } }),
      entry('elsewhere', { spend: 100 }),
    ]);
    expect(view).toMatchObject({
      line: 'One waiting for your OK, one working, one done.',
      milestones: { done: 4, planned: 8 },
      tasks: { done: 14, planned: 26 },
      working: 4,
      spent: 7.5,
      level: 'ok',
      needsYou: 2,
      held: false,
      firstNeed: { text: 'Which pickup window?' },
    });
  });

  it('is held once its companies together reach the budget, warned at 80%', () => {
    const at = (spent: number) => rollUp(p, [entry('plant-pal', {}, { spend: { spent, budget: null } })]);
    expect(at(15.99).level).toBe('ok');
    expect(at(16).level).toBe('warning');
    expect(at(19.99).held).toBe(false);
    expect(at(20)).toMatchObject({ held: true, level: 'paused', line: 'Paused: its $20 budget is spent.' });
    expect(rollUp({ ...p, budget: null }, [entry('plant-pal', {}, { spend: { spent: 900, budget: null } })]).held).toBe(false);
  });

  it('says so when it is empty, and counts a company that can not run as stuck', () => {
    expect(portfolioLine({}, false, p)).toBe('No companies in it yet.');
    expect(rollUp(p, [entry('plant-pal', { problem: 'Its folder is gone.', summary: undefined })]).line).toBe('One stuck.');
  });
});

describe("the hold on a company's desks", () => {
  function desks() {
    const calls: string[] = [];
    const inner = { pause: (u: number | null) => calls.push(`pause ${u}`), resume: () => calls.push('resume') } as unknown as DeskControl;
    return { inner, calls };
  }

  it('pauses the desks while held and lets the company resume them only once it lifts', () => {
    const { inner, calls } = desks();
    const { control, hold } = holdable(inner, () => 0);
    hold.set(true);
    control.resume();
    control.pause(null);
    control.resume();
    expect(calls).toEqual(['pause null']);
    hold.set(false);
    expect(calls).toEqual(['pause null', 'resume']);
  });

  it("gives back the company's own pause, and a timed rest that has run out wakes it", () => {
    const { inner, calls } = desks();
    let now = 0;
    const { control, hold } = holdable(inner, () => now);
    control.pause(null);
    hold.set(true);
    hold.set(false);
    expect(calls).toEqual(['pause null', 'pause null', 'pause null']);
    control.pause(100);
    hold.set(true);
    now = 50;
    hold.set(false);
    expect(calls.at(-1)).toBe('pause 100');
    hold.set(true);
    now = 200;
    hold.set(false);
    expect(calls.at(-1)).toBe('resume');
  });
});
