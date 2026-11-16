// v0.2: bounding a desk's context. A turn that ends with a large context asks for a handover, the desk is closed and the
// next turn is a new session that points at the notes; the same cut is made without a turn when a new task reaches
// someone with nothing else open. The switchboard is the company kit's fake, which reports contexts as a test says.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fold, foldAll, foundedState, HANDOVERS_KEPT, isCompanyEvent, own, reviveState, SESSIONS_KEPT } from '../src/core/company-state.ts';
import { type AssignInput, LIMITS, type Person, type Task, THE_OFFICE, type TurnResult } from '../src/core/company.ts';
import { MAX_TASKS_LISTED, taskInFull, tasksInWords } from '../src/orgtools/words.ts';
import { HANDOVER_TOKENS, BOUNDARY_TOKENS, MIN_PAGE_TURNS, NOTES_MAX_CHARS } from '../src/company/handover.ts';
import { analyseRun, loadCompany } from '../scripts/accounting.ts';
import { crashCopy, ended, rig, type Rig } from './company-kit.ts';
import { tempDir } from './library-kit.ts';

const KAI = '0b7c1d2e-0000-4000-8000-0000000000bb';
const KAI_2 = '0b7c1d2e-0000-4000-8000-0000000000b2';
const NOTES = '.worklings/handover/ui-designer.md';

const work = (to: string, title: string): AssignInput => ({ to, title, brief: `${title}.`, files: [`src/${title.toLowerCase().replace(/\W+/g, '-')}`], doneWhen: 'npm test passes.', parent: null, milestone: null, worktree: false });
const result = (tokens: number | null, session = KAI, extra: Partial<TurnResult> = {}): TurnResult => ({ ...ended('Done.'), sessionId: session, contextTokens: tokens, ...extra });
const tick = () => new Promise<void>((done) => setTimeout(done, 5));

/** A running company where Kai (the UI designer) has a session and has taken `turns` turns at `tokens` of context. */
async function withKai(turns: number, tokens: number | null): Promise<Rig> {
  const r = await rig({ running: true, now: () => Date.now() });
  r.desks().events.session('ui-designer', KAI);
  for (let i = 0; i < turns; i++) r.desks().events.turn('ui-designer', result(tokens));
  return r;
}

const asksFor = (r: Rig, person = 'ui-designer') => r.desks().textsFor(person).filter((t) => t.includes('Your context has grown large'));
const stateOf = (r: Rig) => loadCompany(r.root).state;
const notesPath = (r: Rig, rel = NOTES) => join(r.root, ...rel.split('/'));

describe('a handover at a large context', () => {
  it('is asked for when a turn ends at the threshold, never before the desk has taken its turns, and never mid-turn', async () => {
    const r = await withKai(MIN_PAGE_TURNS - 1, HANDOVER_TOKENS + 5_000);
    // Large, but the page is too young: no ask yet.
    expect(asksFor(r)).toEqual([]);
    // Mid-turn nothing is asked, however large the desk's context reads.
    r.desks().events.desk({ person: 'ui-designer', state: 'working', sessionId: KAI, since: Date.now(), context: 0.9, problem: null, queue: null });
    expect(asksFor(r)).toEqual([]);
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS - 1));
    expect(asksFor(r)).toEqual([]);

    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS));
    const [ask] = asksFor(r);
    expect(ask).toContain(`Under 60 lines`);
    expect(ask).toContain(notesPath(r));
    expect(ask).toContain('What you are doing and why.');
    expect(ask).toContain('The state of each open task of yours');
    expect(ask).toContain('Files you touched and the decisions you made');
    expect(ask).toContain('The exact next steps, in order.');
    expect(ask).toContain('What to read first');
    // The ask is the office's own fenced turn.
    expect(r.desks().textsFor('ui-designer').at(-1)).toMatch(/^From the office: Your context has grown large/);
    expect(existsSync(join(r.root, '.worklings', 'handover'))).toBe(true);
  });

  it('asks once, however many turns end before the ask is taken', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 1);
    expect(asksFor(r)).toHaveLength(1);
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 9_000));
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 12_000));
    expect(asksFor(r)).toHaveLength(1);
  });

  it("waits for a quieter turn end when work is already waiting for the person", async () => {
    const r = await withKai(MIN_PAGE_TURNS - 1, HANDOVER_TOKENS + 1);
    r.company.say('ui-designer', 'Also: the logo.');
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 1));
    expect(asksFor(r)).toEqual([]);
    r.desks().deliverAll();
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 2));
    expect(asksFor(r)).toHaveLength(1);
  });

  it('uses the notes the person wrote, closes the desk and starts the next turn on a new session that points at the file', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 10_000);
    const desks = r.desks();
    desks.deliverAll();
    writeFileSync(notesPath(r), '# Kai\nDoing the palette because the menu needs it.\nNext: tokens.ts, then the cards.\n');
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 12_000));
    expect(desks.closed).toEqual(['ui-designer']);

    const log = r.company.view().log.at(-1);
    expect(log).toMatchObject({ kind: 'handover', by: THE_OFFICE, text: `Kai started a fresh page: their notes are in ${NOTES}.` });
    expect(r.company.view().people.find((p) => p.id === 'ui-designer')?.context).toEqual({ tokens: null, fresh: 1 });
    // Their own notes stand untouched.
    expect(readFileSync(notesPath(r), 'utf8')).toContain('Doing the palette');
    expect(stateOf(r).desks['ui-designer']).toMatchObject({ sessionId: null, fresh: 1, turns: 0, handover: null, freshFrom: 'person' });

    // A message that comes while the old desk is closing waits, and goes out once it is gone.
    const before = desks.turns.length;
    r.company.say('ui-designer', 'Now the footer.');
    expect(desks.turns.length).toBe(before);
    await tick();
    const next = desks.turns.at(-1);
    expect(next?.plan.sessionId).toBeNull();
    expect(next?.plan.fresh).toBe(true);
    expect(next?.turn.text).toContain('Now the footer.');
    expect(next?.turn.text).toContain('Your desk is new');
    expect(next?.turn.text).toContain(`Read the notes you wrote first, in ${notesPath(r)}`);
    expect(next?.turn.text).toContain('stakeholder_words');

    // The new session's first turn ends: the pointer stops, and the handover records what the new page grew to.
    desks.events.session('ui-designer', KAI_2);
    desks.events.turn('ui-designer', result(21_000, KAI_2));
    r.company.say('ui-designer', 'And the header.');
    await tick();
    expect(desks.turns.at(-1)?.turn.text).not.toContain('Your desk is new');
    expect(desks.turns.at(-1)?.plan.sessionId).toBe(KAI_2);
    expect(desks.turns.at(-1)?.plan.fresh).toBeUndefined();
    const desk = stateOf(r).desks['ui-designer'];
    expect(desk?.handovers).toEqual([{ at: expect.any(Number), by: 'person', before: HANDOVER_TOKENS + 12_000, after: 21_000 }]);
    expect(desk?.sessions).toEqual([KAI, KAI_2]);
  });

  it('does not take the old session back from a late report of the closing desk', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 1);
    r.desks().deliverAll();
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 2));
    r.desks().events.desk({ person: 'ui-designer', state: 'closed', sessionId: KAI, since: Date.now(), context: null, problem: null, queue: null });
    r.desks().events.session('ui-designer', KAI);
    expect(stateOf(r).desks['ui-designer']?.sessionId).toBeNull();
  });

  it('writes minimal notes from the board when the person wrote none, and says so', async () => {
    const r = await withKai(0, null);
    const task = r.company.assign('head-of-design', work('ui-designer', 'Palette'));
    const desks = r.desks();
    desks.deliverAll();
    desks.events.session('ui-designer', KAI);
    for (let i = 0; i < MIN_PAGE_TURNS; i++) desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 1_000));
    desks.deliverAll();
    expect(existsSync(notesPath(r))).toBe(false);
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 2_000));

    const notes = readFileSync(notesPath(r), 'utf8');
    expect(notes).toContain('# Handover for Kai, UI designer');
    expect(notes).toContain(`${task.id} "Palette"`);
    expect(notes).toContain('Done when: npm test passes.');
    expect(notes).toContain('stakeholder_words');
    expect(notes.split('\n').length).toBeLessThanOrEqual(60);
    expect(r.company.view().log.at(-1)?.text).toBe(`Kai started a fresh page: the office wrote their notes from the board, and they are in ${NOTES}.`);
    expect(stateOf(r).desks['ui-designer']?.freshFrom).toBe('office');

    // Kai still has the task: the fresh desk is told to carry on, from the notes.
    await tick();
    const next = desks.turns.at(-1);
    expect(next?.turn.text).toContain('You\'re on a fresh desk. Carry on with "Palette", from your handover notes.');
    expect(next?.turn.text).toContain('Read notes the office wrote from its records first');
    expect(next?.plan.sessionId).toBeNull();
  });

  it('falls back to the office notes when the handover turn failed, and does not page the manager about it', async () => {
    const r = await withKai(0, null);
    r.company.assign('head-of-design', work('ui-designer', 'Palette'));
    const desks = r.desks();
    desks.deliverAll();
    desks.events.session('ui-designer', KAI);
    for (let i = 0; i < MIN_PAGE_TURNS; i++) desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 1_000));
    desks.deliverAll();
    const messagesBefore = r.company.view().messages.length;
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 1_000, KAI, { ok: false, problem: 'Claude Code stopped with an error.' }));
    expect(stateOf(r).desks['ui-designer']?.freshFrom).toBe('office');
    expect(r.company.view().messages.slice(messagesBefore).filter((m) => m.to === 'head-of-design')).toEqual([]);
  });

  it('does not page the manager when the turn that wrote the handover left a task open', async () => {
    const r = await withKai(0, null);
    r.company.assign('head-of-design', work('ui-designer', 'Palette'));
    const desks = r.desks();
    desks.deliverAll();
    desks.events.session('ui-designer', KAI);
    for (let i = 0; i < MIN_PAGE_TURNS; i++) desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 1_000));
    desks.deliverAll();
    writeFileSync(notesPath(r), 'Palette in progress: tokens done, cards left. Read src/palette first.\n');
    const heads = () => r.company.view().messages.filter((m) => m.to === 'head-of-design' && m.text.includes('still under way'));
    const asked = heads().length;
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 2_000));
    expect(heads()).toHaveLength(asked);
  });

  it('keeps a longer file to what a desk should read', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 1);
    r.desks().deliverAll();
    writeFileSync(notesPath(r), `${'x'.repeat(NOTES_MAX_CHARS * 3)}\n`);
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 2));
    const notes = readFileSync(notesPath(r), 'utf8');
    expect(notes.length).toBeLessThan(NOTES_MAX_CHARS + 200);
    expect(notes).toContain('The office cut these notes here');
  });

  it('never loops: a fresh page takes its turns before it can be handed over again', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 1);
    const desks = r.desks();
    desks.deliverAll();
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 2));
    await tick();
    expect(asksFor(r)).toHaveLength(1);
    // Even if the new page reported a large context at once, it asks again only after its own turns.
    desks.events.session('ui-designer', KAI_2);
    for (let i = 0; i < MIN_PAGE_TURNS - 1; i++) desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 5_000, KAI_2));
    expect(asksFor(r)).toHaveLength(1);
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 5_000, KAI_2));
    expect(asksFor(r)).toHaveLength(2);
    expect(stateOf(r).desks['ui-designer']?.fresh).toBe(1);
  });

  it('is not asked of someone away, or of a company that is not running', async () => {
    const r = await withKai(MIN_PAGE_TURNS - 1, HANDOVER_TOKENS + 1);
    r.company.handOver('ui-designer');
    r.desks().events.turn('ui-designer', result(HANDOVER_TOKENS + 1));
    expect(asksFor(r)).toEqual([]);
  });
});

describe('a handover at a task boundary', () => {
  async function heavy(tokens: number) {
    const r = await withKai(MIN_PAGE_TURNS, tokens);
    r.desks().deliverAll();
    return r;
  }

  it('cuts without a turn when a new task reaches someone with nothing else open, and starts the task on a new session', async () => {
    const r = await heavy(BOUNDARY_TOKENS + 5_000);
    const desks = r.desks();
    const before = desks.turns.length;
    const task = r.company.assign('head-of-design', work('ui-designer', 'Footer'));
    // Nothing was written to the old desk: it is closed first.
    expect(desks.turns.length).toBe(before);
    expect(desks.closed).toEqual(['ui-designer']);
    expect(r.company.view().log.at(-1)).toMatchObject({ kind: 'handover', text: `Kai started a fresh page: the office wrote their notes from the board, and they are in ${NOTES}.` });
    expect(readFileSync(notesPath(r), 'utf8')).toContain('# Handover for Kai');
    await tick();
    const next = desks.turns.at(-1);
    expect(next?.turn.text).toContain(`New task ${task.id}`);
    expect(next?.turn.text).toContain('Your desk is new');
    expect(next?.plan.sessionId).toBeNull();
    expect(next?.plan.fresh).toBe(true);
    expect(desks.turns.filter((t) => t.turn.text.includes('Your context has grown large'))).toEqual([]);
  });

  it('leaves a lighter desk alone', async () => {
    const r = await heavy(BOUNDARY_TOKENS - 1);
    r.company.assign('head-of-design', work('ui-designer', 'Footer'));
    expect(r.desks().closed).toEqual([]);
    expect(r.desks().turns.at(-1)?.plan.sessionId).toBe(KAI);
  });

  it('leaves a desk alone while another task of theirs is open', async () => {
    const r = await withKai(0, null);
    r.company.assign('head-of-design', work('ui-designer', 'Palette'));
    r.desks().deliverAll();
    r.desks().events.session('ui-designer', KAI);
    for (let i = 0; i < MIN_PAGE_TURNS; i++) r.desks().events.turn('ui-designer', result(BOUNDARY_TOKENS + 1_000));
    r.company.assign('head-of-design', work('ui-designer', 'Footer'));
    expect(r.desks().closed).toEqual([]);
  });

  it('leaves a desk alone that is in a turn', async () => {
    const r = await heavy(BOUNDARY_TOKENS + 5_000);
    r.desks().views = [{ person: 'ui-designer', state: 'working', sessionId: KAI, since: Date.now(), context: 0.3, problem: null, queue: null }];
    r.company.assign('head-of-design', work('ui-designer', 'Footer'));
    expect(r.desks().closed).toEqual([]);
  });
});

describe('a restart in the middle of a handover', () => {
  it('asks again when the turn that held the ask was lost, on the same session', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 1);
    r.desks().deliverAll();
    expect(asksFor(r)).toHaveLength(1);
    const restarted = r.reopen(crashCopy(r.root));
    const board = r.boards.at(-1);
    const asks = board?.textsFor('ui-designer').filter((t) => t.includes('Your context has grown large')) ?? [];
    expect(asks).toHaveLength(1);
    expect(board?.turns.find((t) => t.turn.text.includes('Your context has grown large'))?.plan.sessionId).toBe(KAI);
    // Not also told to carry on: the ask is their next turn.
    expect(board?.textsFor('ui-designer').filter((t) => t.includes('Carry on'))).toEqual([]);
    await restarted.close();
  });

  it("finishes the handover when the person's notes were written before the restart", async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 1);
    r.desks().deliverAll();
    writeFileSync(notesPath(r), 'Doing the cards. Next: the footer. Read src/cards first.\n');
    const restarted = r.reopen(crashCopy(r.root));
    const board = r.boards.at(-1);
    expect(board?.closed).toContain('ui-designer');
    const view = restarted.view();
    expect(view.log.filter((l) => l.kind === 'handover')).toHaveLength(1);
    expect(view.people.find((p) => p.id === 'ui-designer')?.context).toEqual({ tokens: null, fresh: 1 });
    // The ask is not made again.
    expect(board?.textsFor('ui-designer').filter((t) => t.includes('Your context has grown large'))).toEqual([]);
    await restarted.close();
  });

  it('carries on afterwards on a new session that points at the notes, when the restart came after the cut', async () => {
    const r = await withKai(0, null);
    r.company.assign('head-of-design', work('ui-designer', 'Palette'));
    const desks = r.desks();
    desks.deliverAll();
    desks.events.session('ui-designer', KAI);
    for (let i = 0; i < MIN_PAGE_TURNS; i++) desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 1_000));
    desks.deliverAll();
    writeFileSync(notesPath(r), 'Palette: tokens done, cards left.\n');
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 2_000));
    // The cut is on disk; the carry-on turn never went out.
    const restarted = r.reopen(crashCopy(r.root));
    const board = r.boards.at(-1);
    const turn = board?.turns.find((t) => t.plan.person.id === 'ui-designer');
    expect(turn?.turn.text).toContain('The office restarted. Carry on with "Palette".');
    expect(turn?.turn.text).toContain('Your desk is new');
    expect(turn?.plan.sessionId).toBeNull();
    expect(turn?.plan.fresh).toBe(true);
    expect(stateOf(r).desks['ui-designer']?.sessions).toEqual([KAI]);
    await restarted.close();
  });
});

describe('the accounting of handovers', () => {
  it('counts them, with the context before and after, and keeps every session of a person', async () => {
    const r = await withKai(MIN_PAGE_TURNS, HANDOVER_TOKENS + 10_000);
    const desks = r.desks();
    desks.deliverAll();
    desks.events.turn('ui-designer', result(HANDOVER_TOKENS + 12_000));
    await tick();
    desks.events.session('ui-designer', KAI_2);
    desks.events.turn('ui-designer', result(23_000, KAI_2));
    await r.company.close();

    const report = analyseRun(r.root, tempDir('worklings-projects-'));
    expect(report.handovers).toEqual([{ person: 'ui-designer', at: expect.any(Number), by: 'office', before: HANDOVER_TOKENS + 12_000, after: 23_000 }]);
    expect(loadCompany(r.root).state.desks['ui-designer']?.sessions).toEqual([KAI, KAI_2]);
  });
});

describe('the desk record', () => {
  const founded = () => foundedState({ type: 'founded', id: 'cafe-a1b2c3', name: 'Pickup Café', root: '/tmp/cafe', prompt: 'A café site.', stakeholder: 'Robin', at: 1_000 });

  it('folds a handover: the session is dropped, the page counts, and the next turn tells what it grew to', () => {
    const state = foldAll(founded(), [
      { type: 'session', person: 'ui-designer', sessionId: KAI },
      { type: 'turn', person: 'ui-designer', cost: 0.1, contextTokens: 95_000, at: 2_000 },
      { type: 'handover-asked', person: 'ui-designer', messageId: 'm-9', at: 2_100, tokens: 95_000 },
    ]);
    expect(own(state.desks, 'ui-designer')).toMatchObject({ handover: { messageId: 'm-9', at: 2_100, tokens: 95_000 }, turns: 1, fresh: 0 });
    const cut = fold(state, { type: 'handover', person: 'ui-designer', by: 'person', at: 2_200, tokens: 96_000 });
    expect(own(cut.desks, 'ui-designer')).toMatchObject({ sessionId: null, contextTokens: null, handover: null, fresh: 1, turns: 0, freshFrom: 'person', sessions: [KAI] });
    const after = fold(cut, { type: 'turn', person: 'ui-designer', cost: 0.01, contextTokens: 15_000, at: 2_300 });
    expect(own(after.desks, 'ui-designer')).toMatchObject({ freshFrom: null, turns: 1, handovers: [{ at: 2_200, by: 'person', before: 96_000, after: 15_000 }] });
  });

  it('reads a company saved before handovers, and one saved with them', () => {
    const legacy = JSON.parse(JSON.stringify(foldAll(founded(), [{ type: 'turn', person: 'ui-designer', cost: 0.1, contextTokens: 1_000, at: 2_000 }]))) as { desks: Record<string, Record<string, unknown>> };
    for (const key of ['fresh', 'turns', 'handover', 'freshFrom', 'handovers']) delete legacy.desks['ui-designer']?.[key];
    expect(own(reviveState(legacy)?.desks ?? {}, 'ui-designer')).toMatchObject({ fresh: 0, turns: 0, handover: null, freshFrom: null, handovers: [] });
    const saved = foldAll(founded(), [
      { type: 'handover-asked', person: 'ui-designer', messageId: 'm-1', at: 5, tokens: 91_000 },
      { type: 'handover', person: 'ui-designer', by: 'office', at: 6, tokens: 91_000 },
    ]);
    expect(own(reviveState(JSON.parse(JSON.stringify(saved)))?.desks ?? {}, 'ui-designer')).toEqual(own(saved.desks, 'ui-designer'));
    expect(isCompanyEvent({ type: 'handover', person: 'a', by: 'person', at: 1, tokens: null })).toBe(true);
  });

  it('keeps the newest of the handovers and sessions', () => {
    let state = founded();
    for (let i = 0; i < HANDOVERS_KEPT + 5; i++) state = fold(state, { type: 'handover', person: 'ui-designer', by: 'office', at: i, tokens: i });
    expect(own(state.desks, 'ui-designer')?.handovers).toHaveLength(HANDOVERS_KEPT);
    for (let i = 0; i < SESSIONS_KEPT + 5; i++) state = fold(state, { type: 'session', person: 'ui-designer', sessionId: `0b7c1d2e-0000-4000-8000-${String(i).padStart(12, '0')}` });
    expect(own(state.desks, 'ui-designer')?.sessions).toHaveLength(SESSIONS_KEPT);
  });
});

describe('what the office returns to a desk is bounded', () => {
  const person = (i: number): Person => ({ id: `p-${i}`, name: `Person ${i}`, title: 'Engineer', room: 'engineering', level: 'worker', reportsTo: 'ceo', look: { skin: 0, hair: 0, hairColor: 0, shirt: 0 } }) as unknown as Person;
  const task = (i: number): Task => ({
    id: `t-${i}`, title: 'T'.repeat(LIMITS.title), brief: 'b'.repeat(LIMITS.brief), owner: 'p-1', askedBy: 'ceo', files: Array.from({ length: 50 }, (_, f) => `src/some/long/path/file-${f}.ts`), doneWhen: 'd'.repeat(LIMITS.doneWhen),
    status: 'working', outcome: 'o'.repeat(LIMITS.report), parent: null, milestone: null, worktree: null, commit: null, createdAt: 1, updatedAt: 1,
  });

  it('caps the task list and one task in full, at a few thousand tokens', () => {
    const people = Array.from({ length: 25 }, (_, i) => person(i));
    const list = tasksInWords(Array.from({ length: 500 }, (_, i) => task(i)), people, true);
    expect(list.length).toBeLessThan(MAX_TASKS_LISTED * 400);
    // About four characters to a token: a worst-case list stays near five thousand tokens.
    expect(list.length / 4).toBeLessThan(5_000);
    expect(taskInFull(task(1), people).length).toBeLessThan(LIMITS.brief + LIMITS.doneWhen + LIMITS.report + 2_000);
  });
});
