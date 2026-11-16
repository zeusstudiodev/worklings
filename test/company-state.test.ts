import { describe, expect, it } from 'vitest';
import {
  type CompanyEvent,
  type CompanyState,
  fold,
  foldAll,
  foundedState,
  isCompanyEvent,
  own,
  reviveState,
  STATE_LIMITS,
} from '../src/core/company-state.ts';
import { type Approval, type Message, STAKEHOLDER, type Task } from '../src/core/company.ts';

const founded = (): CompanyState => foundedState({ type: 'founded', id: 'cafe-a1b2c3', name: 'Pickup Café', root: '/tmp/cafe', prompt: 'A café site.', stakeholder: 'Robin', at: 1_000 });

const message = (id: string, extra: Partial<Message> = {}): Message => ({
  id, from: STAKEHOLDER, to: 'ui-designer', text: 'Make the palette darker.', origin: null, relayOf: null, at: 2_000, deliveredAt: null, interrupt: false, note: null, ...extra,
});

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: `Task ${id}`, brief: 'Do it.', owner: 'ui-designer', askedBy: 'head-of-design', files: [], doneWhen: 'It is done.', status: 'working', outcome: null,
  parent: null, milestone: null, worktree: null, commit: null, createdAt: 3_000, updatedAt: 3_000, ...extra,
});

/** Freezes a value and everything in it, so a fold that changes its input throws. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('the company state', () => {
  it('folds without changing the state it is given', () => {
    const before = deepFreeze(foldAll(founded(), [{ type: 'message', message: message('m-1') }, { type: 'task', task: task('t-1'), messageId: 'm-1' }]));
    const copy = JSON.stringify(before);
    const events: CompanyEvent[] = [
      { type: 'delivered', id: 'm-1', at: 2_500 },
      { type: 'task-status', id: 't-1', status: 'review', at: 4_000, outcome: 'Done.' },
      { type: 'turn', person: 'ui-designer', cost: 0.25, contextTokens: 12_000, at: 4_100 },
      { type: 'seen', person: 'ui-designer', at: 4_200 },
      { type: 'session', person: 'ui-designer', sessionId: '0b7c1d2e-0000-4000-8000-000000000001' },
    ];
    const after = foldAll(before, events);
    expect(JSON.stringify(before)).toBe(copy);
    expect(after.messages[0]?.deliveredAt).toBe(2_500);
    expect(after.tasks[0]?.status).toBe('review');
    expect(own(after.desks, 'ui-designer')).toMatchObject({ cost: 0.25, contextTokens: 12_000, sessionId: '0b7c1d2e-0000-4000-8000-000000000001' });
  });

  it('keys records by person ids without a prototype, so "constructor" is just a key', () => {
    const state = foldAll(founded(), [
      { type: 'seen', person: 'constructor', at: 5 },
      { type: 'turn', person: '__proto__', cost: 1, contextTokens: null, at: 6 },
    ]);
    expect(Object.getPrototypeOf(state.seen)).toBeNull();
    expect(own(state.seen, 'constructor')).toBe(5);
    expect(own(state.seen, 'toString')).toBeUndefined();
    expect(own(state.desks, '__proto__')?.cost).toBe(1);
    expect(Object.getPrototypeOf(state.desks)).toBeNull();
  });

  it('keeps its id counters ahead of every id in the log, even with lines missing', () => {
    const state = foldAll(founded(), [{ type: 'message', message: message('m-1') }, { type: 'message', message: message('m-7') }]);
    expect(state.counters.message).toBe(7);
  });

  it('marks a milestone done once all its tasks are done or dropped, and reopens it for a new task', () => {
    const goal = { text: 'Pickup orders work.', milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'They load.', doneAt: null }], setAt: 1 };
    let state = foldAll(founded(), [
      { type: 'goal', goal, at: 1 },
      { type: 'task', task: task('t-1', { milestone: 'ms-1' }), messageId: null },
      { type: 'task', task: task('t-2', { milestone: 'ms-1' }), messageId: null },
      { type: 'task-status', id: 't-1', status: 'done', at: 10 },
    ]);
    expect(state.goal?.milestones[0]?.doneAt).toBeNull();
    state = fold(state, { type: 'task-status', id: 't-2', status: 'dropped', at: 20 });
    expect(state.goal?.milestones[0]?.doneAt).toBe(20);
    expect(state.log.at(-1)).toEqual({ at: 20, kind: 'milestone', by: '@office', text: 'Milestone done: Menu pages live.' });
    state = fold(state, { type: 'task', task: task('t-3', { milestone: 'ms-1', status: 'queued', createdAt: 30 }), messageId: null });
    expect(state.goal?.milestones[0]?.doneAt).toBeNull();
  });

  it('drops the oldest delivered messages past its cap and never an undelivered one', () => {
    const events: CompanyEvent[] = [{ type: 'message', message: message('m-1') }];
    for (let i = 2; i <= STATE_LIMITS.messages + 1; i += 1) events.push({ type: 'message', message: message(`m-${i}`, { deliveredAt: 2_100 }) });
    const state = foldAll(founded(), events);
    expect(state.messages).toHaveLength(STATE_LIMITS.messages);
    expect(state.messages[0]?.id).toBe('m-1');
    expect(state.messages[1]?.id).toBe('m-3');
  });

  it('turns an "Always allow" into a rule once its decision reaches the person', () => {
    const approval: Approval = {
      id: 'a-1', person: 'frontend-engineer', tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push origin worklings/cafe', kind: 'push',
      askedAt: 1, expiresAt: 600_000, alwaysRule: { rule: 'Bash(git push origin worklings/cafe)', sentence: 'any git push of the work branch' }, answer: null, withdrawn: null,
    };
    const answered = foldAll(founded(), [
      { type: 'approval', approval },
      { type: 'decision', id: 'a-1', answer: { decision: 'allow', always: true, at: 2, appliesAt: 5_002, note: null } },
    ]);
    expect(answered.settings.alwaysAllow).toEqual([]);
    const applied = foldAll(answered, [{ type: 'applied', id: 'a-1', at: 5_002 }, { type: 'applied', id: 'a-1', at: 5_003 }]);
    expect(applied.settings.alwaysAllow).toEqual(['Bash(git push origin worklings/cafe)']);
  });

  it('lets an answer be undone only until it is applied', () => {
    const q = { id: 'q-1', from: 'ceo', text: 'Stripe or TWINT?', options: ['Stripe', 'TWINT'], recommended: 1, taskId: null, askedAt: 1, answer: null, withdrawn: null };
    const answer = { option: 1, text: '', at: 2, appliesAt: 5_002 };
    const undone = foldAll(founded(), [{ type: 'question', question: q }, { type: 'answer', id: 'q-1', answer }, { type: 'undo', id: 'q-1' }]);
    expect(undone.questions[0]?.answer).toBeNull();
    const kept = foldAll(founded(), [{ type: 'question', question: q }, { type: 'answer', id: 'q-1', answer }, { type: 'applied', id: 'q-1', at: 5_002 }, { type: 'undo', id: 'q-1' }]);
    expect(kept.questions[0]?.answer).toEqual(answer);
  });

  it('remembers who the stakeholder has written to, who may then write back', () => {
    const state = foldAll(founded(), [{ type: 'message', message: message('m-1', { to: 'ui-designer', at: 42 }) }, { type: 'message', message: message('m-2', { from: 'ceo', to: 'head-of-design' }) }]);
    expect(own(state.wroteTo, 'ui-designer')).toBe(42);
    expect(own(state.wroteTo, 'head-of-design')).toBeUndefined();
  });

  it('comes back from its JSON whole, with its records keyed by id rebuilt without a prototype', () => {
    const state = foldAll(founded(), [
      { type: 'message', message: message('m-1') },
      { type: 'seen', person: 'constructor', at: 9 },
      { type: 'turn', person: 'ui-designer', cost: 0.5, contextTokens: 100, at: 10 },
    ]);
    const revived = reviveState(JSON.parse(JSON.stringify(state)));
    expect(revived).toEqual(state);
    expect(revived && Object.getPrototypeOf(revived.seen)).toBeNull();
    expect(revived && Object.getPrototypeOf(revived.desks)).toBeNull();
    expect(reviveState({ version: 99 })).toBeNull();
  });

  it('starts on Balanced with its desks, its models and no budget', () => {
    expect(founded().settings).toMatchObject({ preset: 'balanced', maxDesks: 5, models: { ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' }, budget: { company: null, person: null } });
  });

  it('revives a company from before the spending plan on Balanced, with the desks it had and no budget', () => {
    const old = JSON.parse(JSON.stringify(founded())) as { settings: Record<string, unknown> };
    delete old.settings.preset;
    delete old.settings.models;
    delete old.settings.budget;
    old.settings.maxDesks = 8;
    expect(reviveState(old)?.settings).toMatchObject({ preset: 'balanced', maxDesks: 8, models: { ceo: 'opus', worker: 'sonnet' }, budget: { company: null, person: null } });
    delete old.settings.maxDesks;
    expect(reviveState(old)?.settings.maxDesks).toBe(8);
  });

  it('keeps a saved preset, models and budget, and drops what it cannot read', () => {
    const saved = JSON.parse(JSON.stringify(founded())) as { settings: Record<string, unknown> };
    saved.settings.preset = 'lean';
    saved.settings.models = { ceo: 'sonnet', head: 'opus', lead: 'gpt-9', worker: 7 };
    saved.settings.budget = { company: 40.255, person: -3 };
    expect(reviveState(saved)?.settings).toMatchObject({ preset: 'lean', models: { ceo: 'sonnet', head: 'opus', lead: 'sonnet', worker: 'sonnet' }, budget: { company: 40.26, person: null } });
    saved.settings.preset = 'huge';
    saved.settings.budget = 'a lot';
    expect(reviveState(saved)?.settings).toMatchObject({ preset: 'balanced', budget: { company: null, person: null } });
  });

  it('reads only events it knows', () => {
    expect(isCompanyEvent({ type: 'message', message: message('m-1') })).toBe(true);
    expect(isCompanyEvent({ type: 'rm -rf' })).toBe(false);
    expect(isCompanyEvent('message')).toBe(false);
    expect(fold(founded(), { type: 'founded', id: 'other', name: '', root: '', prompt: '', stakeholder: '', at: 0 }).id).toBe('cafe-a1b2c3');
  });
});
