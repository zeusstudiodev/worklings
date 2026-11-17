// v0.7: the plain company (SPEC-v0.7.md). One Claude Code session works on the person's words; its end-of-turn words
// wait in the inbox, the person's reply reaches it verbatim, and its todo list and subagents show without changing it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeskEvents, STAKEHOLDER, UNDO_MS } from '../src/core/company.ts';
import { emptyWorkBook, foldWork, workSignals } from '../src/core/desk-work.ts';
import { stageOf, summaryInputOfView } from '../src/core/overview.ts';
import { cleanLaunch, DEFAULT_LAUNCH, PLAIN_PERSON } from '../src/core/plain.ts';
import { createCompany, openCompany } from '../src/company/index.ts';
import { ended, FakeDesks, fakeGit, fakeOrg, KEY, newProject } from './company-kit.ts';

function plainRig(prompt = 'Add a --json flag to the CLI.') {
  const root = newProject();
  const boards: FakeDesks[] = [];
  const git = fakeGit();
  const org = fakeOrg();
  const deps = {
    key: KEY, org, git, warn: () => {}, env: {}, now: () => Date.now(),
    desks: (events: DeskEvents, companyId: string) => {
      const b = new FakeDesks(events, companyId);
      boards.push(b);
      return b;
    },
  };
  const company = createCompany({ ...deps, root, prompt, stakeholder: 'Robin', shape: 'plain', launch: { model: 'sonnet', effort: null, permissionMode: 'acceptEdits', planFirst: false } });
  const desks = () => boards.at(-1) as FakeDesks;
  return { root, company, desks, org, git, reopen: () => openCompany({ ...deps, root }) };
}

describe('a plain company', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-15T10:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at once with the one person at the desk and the words as written, with no CEO, branch or org files', async () => {
    const r = plainRig();
    await r.company.idle();
    const v = r.company.view();
    expect(v.shape).toBe('plain');
    expect(v.phase).toBe('running');
    expect(v.people.map((p) => p.id)).toEqual([PLAIN_PERSON]);
    expect(r.desks().turns).toHaveLength(1);
    expect(r.desks().turns[0]?.turn.text).toBe('Add a --json flag to the CLI.');
    expect(r.desks().turns[0]?.plan.plain).toEqual({ model: 'sonnet', effort: null, permissionMode: 'acceptEdits', planFirst: false });
    expect(r.org.calls).toEqual([]);
    expect(r.git.calls).toEqual([]);
    expect(v.launch?.permissionMode).toBe('acceptEdits');
  });

  it("puts the session's last words in the inbox when its turn ends, and sends the reply back verbatim", async () => {
    const r = plainRig();
    const first = r.desks().turns[0];
    if (!first?.turn.messageId) throw new Error('no first turn');
    r.desks().events.delivered(first.turn.messageId, Date.now());
    r.desks().events.turn(PLAIN_PERSON, ended('Two questions first: which output shape, and should errors be JSON too?'));
    const waiting = r.company.view().questions.filter((q) => q.answer === null && q.withdrawn === null);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.text).toBe('Two questions first: which output shape, and should errors be JSON too?');
    r.company.answer(waiting[0]?.id ?? '', { option: null, text: 'go with your assumptions' });
    await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
    const turns = r.desks().turns;
    expect(turns.at(-1)?.turn.text).toBe('go with your assumptions');
  });

  // v0.8: the take-1 to take-4 film runs: Claude Code started its subagents in the background, ended its turn ("Both
  // subagents are running..."), and a background task's notification began its next turn with no reply from the person
  // (the switchboard's ownTurn, from the shape in test/fixtures/claude-2.1.312/desk/priority-now-human.jsonl).
  it('takes back the waiting words when the session goes on by itself, so only its latest end of turn is open', () => {
    const r = plainRig();
    const first = r.desks().turns[0];
    if (!first?.turn.messageId) throw new Error('no first turn');
    r.desks().events.delivered(first.turn.messageId, Date.now());
    r.desks().events.turn(PLAIN_PERSON, ended("Both subagents are running. I'm waiting for them before I run npm test."));
    const open = () => r.company.view().questions.filter((q) => q.answer === null && q.withdrawn === null);
    expect(open()).toHaveLength(1);
    const stage = () => stageOf(summaryInputOfView(r.company.view()), Date.now());
    expect(stage()).toBe('your-turn');
    r.desks().events.ownTurn?.(PLAIN_PERSON);
    expect(open()).toEqual([]);
    const gone = r.company.view().questions.find((q) => q.plainTurn === true);
    expect(gone?.withdrawn?.reason).toBe('Claude Code went on by itself.');
    expect(stage()).not.toBe('your-turn');
    // Nothing was sent to the session on the person's behalf.
    expect(r.desks().turns).toHaveLength(1);
    r.desks().events.turn(PLAIN_PERSON, ended('npm test passes: 9 tests, 0 failures.'));
    expect(open().map((q) => q.text)).toEqual(['npm test passes: 9 tests, 0 failures.']);
  });

  it('sends a reply written to words the session went on from as a message, rather than losing it', () => {
    const r = plainRig();
    const first = r.desks().turns[0];
    if (!first?.turn.messageId) throw new Error('no first turn');
    r.desks().events.delivered(first.turn.messageId, Date.now());
    r.desks().events.turn(PLAIN_PERSON, ended("Both subagents are running. I'm waiting for them."));
    const words = r.company.view().questions.find((q) => q.plainTurn === true);
    r.desks().events.ownTurn?.(PLAIN_PERSON);
    r.company.answer(words?.id ?? '', { option: null, text: 'Also add tags to the search.' });
    expect(r.desks().turns.at(-1)?.turn.text).toBe('Also add tags to the search.');
    expect(r.company.view().messages.at(-1)).toMatchObject({ from: STAKEHOLDER, to: PLAIN_PERSON, answers: words?.id });
    // With no words there is nothing to send: the item stays withdrawn and says so.
    expect(() => r.company.answer(words?.id ?? '', { option: null, text: '' })).toThrow(/withdrawn/);
  });

  it('takes back the waiting words when the person writes to the session instead', () => {
    const r = plainRig();
    const first = r.desks().turns[0];
    if (!first?.turn.messageId) throw new Error('no first turn');
    r.desks().events.delivered(first.turn.messageId, Date.now());
    r.desks().events.turn(PLAIN_PERSON, ended('Done: the flag prints JSON.'));
    r.company.say(PLAIN_PERSON, 'Also add it to the README.');
    expect(r.desks().turns.at(-1)?.turn.text).toBe('Also add it to the README.');
    const said = r.desks().turns.at(-1)?.turn.messageId ?? '';
    r.desks().events.delivered(said, Date.now());
    r.desks().events.turn(PLAIN_PERSON, ended('README updated.'));
    const open = r.company.view().questions.filter((q) => q.answer === null && q.withdrawn === null);
    expect(open.map((q) => q.text)).toEqual(['README updated.']);
  });

  it('never tells the session anything after a restart', () => {
    const r = plainRig();
    r.desks().events.turn(PLAIN_PERSON, ended('Working on it.'));
    void r.company.close();
    const again = r.reopen();
    const board = r.desks();
    expect(board.turns.filter((t) => t.turn.messageId === null || !t.turn.text.startsWith('Add a --json'))).toEqual([]);
    void again.close();
  });
});

describe('the launch choices', () => {
  it('keeps what Claude Code takes and leaves anything else to it', () => {
    expect(cleanLaunch({ model: 'opus', effort: 'max', permissionMode: 'bypassPermissions', planFirst: true })).toEqual({ model: 'opus', effort: 'max', permissionMode: 'bypassPermissions', planFirst: true });
    expect(cleanLaunch({ model: '--dangerously-skip-permissions', effort: 'huge', permissionMode: 'plan', planFirst: 'yes' })).toEqual(DEFAULT_LAUNCH);
    expect(cleanLaunch(null)).toEqual(DEFAULT_LAUNCH);
  });
});

describe("a desk's own structure, from its stream", () => {
  const at = 1_000;
  it('reads a TodoWrite list as the board', () => {
    const book = emptyWorkBook();
    const line = { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'TodoWrite', input: { todos: [{ content: 'Read the parser', status: 'completed', activeForm: 'Reading' }, { content: 'Add the flag', status: 'in_progress' }, { content: 'bad', status: 'weird' }] } }] } };
    for (const s of workSignals(line)) foldWork(book, s, PLAIN_PERSON, at);
    expect(book.work.todos).toEqual([
      { id: '1', text: 'Read the parser', status: 'completed' },
      { id: '2', text: 'Add the flag', status: 'in_progress' },
    ]);
  });

  it('follows the task tools: a created task gets its id from the result, then updates by it', () => {
    const book = emptyWorkBook();
    const fold = (line: unknown) => {
      for (const s of workSignals(line)) foldWork(book, s, PLAIN_PERSON, at);
    };
    fold({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_c', name: 'TaskCreate', input: { subject: 'Write the tests', description: 'x' } }] } });
    fold({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_c', content: 'Task #3 created' }] }, tool_use_result: { task: { id: '3', subject: 'Write the tests' } } });
    expect(book.work.todos).toEqual([{ id: '3', text: 'Write the tests', status: 'pending' }]);
    fold({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_u', name: 'TaskUpdate', input: { taskId: '3', status: 'completed' } }] } });
    expect(book.work.todos[0]?.status).toBe('completed');
    fold({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_d', name: 'TaskUpdate', input: { taskId: '3', status: 'deleted' } }] } });
    expect(book.work.todos).toEqual([]);
  });

  it('makes a helper of each subagent, priced from its own requests once each', () => {
    const book = emptyWorkBook();
    const fold = (line: unknown) => {
      for (const s of workSignals(line)) foldWork(book, s, PLAIN_PERSON, at);
    };
    fold({ type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'toolu_a', description: 'Find the parser', subagent_type: 'Explore' });
    const request = { type: 'assistant', parent_tool_use_id: 'toolu_a', message: { id: 'msg_1', model: 'claude-haiku-5-5', usage: { input_tokens: 10_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 't', name: 'Grep', input: {} }] } };
    fold(request);
    fold(request);
    fold({ type: 'system', subtype: 'task_notification', task_id: 'a1', tool_use_id: 'toolu_a', status: 'completed', summary: 'found it' });
    expect(book.work.helpers).toHaveLength(1);
    const h = book.work.helpers[0];
    expect(h?.type).toBe('Explore');
    expect(h?.description).toBe('Find the parser');
    expect(h?.state).toBe('done');
    expect(h?.tokens).toBe(10_000);
    expect(h?.costUsd).toBeCloseTo(0.001, 9);
  });

  it('ends a helper when its task_updated says so, and every helper still at work when the desk goes', () => {
    const book = emptyWorkBook();
    const fold = (line: unknown) => {
      for (const s of workSignals(line)) foldWork(book, s, PLAIN_PERSON, at);
    };
    fold({ type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'toolu_a', description: 'One', subagent_type: 'Explore', task_type: 'local_agent' });
    fold({ type: 'system', subtype: 'task_started', task_id: 'a2', tool_use_id: 'toolu_b', description: 'Two', subagent_type: 'Explore', task_type: 'local_agent' });
    fold({ type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'toolu_c', description: 'A background shell', task_type: 'local_bash' });
    fold({ type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'completed', end_time: 1 } });
    expect(book.work.helpers.map((h) => `${h.description}:${h.state}`)).toEqual(['One:done', 'Two:working']);
    foldWork(book, { kind: 'desk-gone', failed: true }, PLAIN_PERSON, at);
    expect(book.work.helpers.map((h) => h.state)).toEqual(['done', 'failed']);
  });

  it("leaves a subagent's own todo calls off the person's board", () => {
    const line = { type: 'assistant', parent_tool_use_id: 'toolu_a', message: { id: 'm', model: 'x', content: [{ type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos: [{ content: 'sub', status: 'pending' }] } }] } };
    expect(workSignals(line).some((s) => s.kind === 'todos')).toBe(false);
  });
});
