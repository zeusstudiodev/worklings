// v0.2, "step-ins near zero after the plan is approved" (SPEC-v0.2.md, "Better by design", 7): who may reach the stakeholder
// (the CEO, once the plan is approved), what an ask carries (a pick, a sentence, a default that applies by itself), how asks
// raised together are one batch answered with one press, and the plan that waits for approval in everyday words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ApprovalAsk, BATCH_WINDOW_MS, OrgRefusal, QUESTION_WAIT_MS, STAKEHOLDER, UNDO_MS } from '../src/core/company.ts';
import { isOpenItem } from '../src/core/company-state.ts';
import { rig } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T10:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

const running = () => rig({ running: true, now: () => Date.now() });
const Q = { text: 'Which blue?', options: ['Navy', 'Teal'], recommended: 1, taskId: null };

const push = (extra: Partial<ApprovalAsk> = {}): ApprovalAsk => ({
  tool: 'Bash',
  summary: 'Push the work branch to GitHub',
  detail: 'git push origin worklings/cafe',
  kind: 'push',
  expiresAt: Date.now() + 600_000,
  alwaysRule: null,
  advice: { recommend: 'deny', why: 'Nothing is pushed from inside a company.', fallback: 'Carry on without pushing.', ifNoAnswer: 'deny' },
  ...extra,
});

const PLAN = {
  goal: 'A menu and its look.',
  milestones: [
    { id: 'ms-1', title: 'Menu', doneWhen: 'The menu is in.' },
    { id: 'ms-2', title: 'Look', doneWhen: 'It matches.' },
  ],
  tasks: [
    { id: 'p-1', title: 'Menu data', owner: 'office-manager', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' },
    { id: 'p-2', title: 'Menu look', owner: 'office-manager', files: ['src/look'], milestone: 'ms-2', after: ['p-1'], brief: 'The look.', doneWhen: 'It matches.', check: 'npm test' },
  ],
  note: null,
  cites: [] as string[],
};

describe('who reaches the stakeholder', () => {
  it("sends a colleague's question to their manager, and a head's to the CEO, whatever they address", async () => {
    const { company, desks } = await running();
    const viaManager = company.ask('ui-designer', { ...Q, to: 'manager' });
    const viaStakeholder = company.ask('ui-designer', { ...Q, to: 'stakeholder' });
    expect('to' in viaManager && viaManager.to).toBe('head-of-design');
    expect('to' in viaStakeholder && viaStakeholder.to).toBe('head-of-design');
    expect(company.view().inbox).toBe(0);
    // Only the second says why it came to the manager, and what to do with it.
    const told = desks().textsFor('head-of-design');
    expect(told.at(-2)).not.toContain('It was meant for');
    expect(told.at(-1)).toContain('It was meant for Robin. Only the CEO reaches them');
    expect(told.at(-1)).toContain('forward it with ask_stakeholder only if it is a product choice, money or something irreversible');
    const head = company.ask('head-of-design', { ...Q, to: 'stakeholder' });
    expect('to' in head && head.to).toBe('ceo');
    expect(company.view().questions.filter((q) => isOpenItem(q, Date.now()))).toEqual([]);
  });

  it("puts only the CEO's question in the inbox, and keeps the question's own checks for everyone", async () => {
    const { company } = await running();
    const asked = company.askStakeholder('ceo', { ...Q });
    expect(company.view().inbox).toBe(1);
    expect(company.view().questions.at(-1)?.id).toBe(asked.id);
    expect(refusal(() => company.askStakeholder('head-of-design', { ...Q })).code).toBe('not-allowed');
    expect(refusal(() => company.ask('ui-designer', { text: 'One option?', options: ['Only'], recommended: null, to: 'stakeholder', taskId: null })).code).toBe('invalid');
  });

  it('refuses the CEO until the plan is approved, and says where an assumption goes instead', async () => {
    const r = await rig({ running: true, now: () => Date.now(), planApproval: 'before-work' });
    const refused = refusal(() => r.company.askStakeholder('ceo', { ...Q }));
    expect(refused.code).toBe('closed');
    expect(refused.message).toContain("Put your assumption in the plan's note");
    expect(refusal(() => r.company.ask('ceo', { ...Q, to: 'stakeholder' })).code).toBe('closed');
    expect(r.company.view().questions.filter((q) => q.from === 'ceo' && isOpenItem(q, Date.now()))).toEqual([]);
    // Colleagues' questions to their manager are not the stakeholder's, so they go on.
    expect('to' in r.company.ask('ui-designer', { ...Q, to: 'manager' })).toBe(true);
    // After the approval the CEO asks as before.
    const proposed = r.company.proposePlan('ceo', withChecklist(PLAN));
    if (!proposed.ok) throw new Error(proposed.errors.join('\n'));
    expect(refusal(() => r.company.askStakeholder('ceo', { ...Q })).code).toBe('closed');
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    expect(r.company.askStakeholder('ceo', { ...Q }).from).toBe('ceo');
  });
});

describe('a default that applies by itself', () => {
  it("stands on the asker's pick when every option is safe, and tells the asker so", async () => {
    const { company, desks } = await running();
    const q = company.askStakeholder('ceo', { ...Q, safe: true });
    expect(company.view().questions.at(-1)).toMatchObject({ id: q.id, safe: true, defaultAt: Date.now() + QUESTION_WAIT_MS });
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS - 1);
    expect(company.view().inbox).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const view = company.view();
    expect(view.questions.find((x) => x.id === q.id)?.answer).toMatchObject({ option: 1, byDefault: true });
    expect(view.inbox).toBe(0);
    expect(desks().textsFor('ceo').at(-1)).toBe(`From Robin, the stakeholder: on "Which blue?": Robin didn't answer in time, so your pick stands: Teal.`);
    // The log says the office decided, not that Robin did.
    expect(view.steering?.decisions.at(-1)).toMatchObject({ by: '@office', kind: 'answer', what: expect.stringContaining('Nobody answered') });
  });

  it('counts as a no for anything else, and the asker carries on with its fallback', async () => {
    const { company, desks } = await running();
    const q = company.askStakeholder('ceo', { text: 'Publish the beta?', options: ['Publish', 'Not yet'], recommended: 1, taskId: null, fallback: 'Keep it on the branch and say so in the handover.' });
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS);
    const item = company.view().questions.find((x) => x.id === q.id);
    expect(item?.answer).toBeNull();
    expect(item?.withdrawn?.reason).toBe('Nobody answered in time, so it counted as a no; Noor carried on with: Keep it on the branch and say so in the handover.');
    expect(company.view().inbox).toBe(0);
    expect(desks().textsFor('ceo').at(-1)).toBe(`From the office: Robin didn't answer "Publish the beta?" in time, so it counts as a no. Carry on with this instead: Keep it on the branch and say so in the handover.`);
  });

  it('never stands on a pick that was not given, even when the asker called the options safe', async () => {
    const { company } = await running();
    const q = company.askStakeholder('ceo', { text: 'Which?', options: ['One', 'Two'], recommended: null, taskId: null, safe: true });
    expect(company.view().questions.at(-1)?.safe).toBe(false);
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS);
    expect(company.view().questions.find((x) => x.id === q.id)).toMatchObject({ answer: null, withdrawn: { reason: expect.stringContaining('counted as a no') } });
  });

  it('leaves an answer given in time alone, and an undone answer still waits for its default', async () => {
    const { company } = await running();
    const q = company.askStakeholder('ceo', { ...Q, safe: true });
    company.answer(q.id, { option: 0, text: '' });
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS + UNDO_MS);
    expect(company.view().questions.find((x) => x.id === q.id)?.answer).toMatchObject({ option: 0 });
    expect(company.view().questions.find((x) => x.id === q.id)?.answer?.byDefault).toBeUndefined();
    const second = company.askStakeholder('ceo', { text: 'Which font?', options: ['Serif', 'Sans'], recommended: 0, taskId: null, safe: true });
    company.answer(second.id, { option: 1, text: '' });
    company.undo(second.id);
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS);
    expect(company.view().questions.find((x) => x.id === second.id)?.answer).toMatchObject({ option: 0, byDefault: true });
  });

  it("doesn't touch the office's own questions, which have their own rules", async () => {
    const { company } = await running();
    const view = company.view();
    const office = view.questions.filter((q) => q.from === '@office');
    for (const q of office) expect(q.defaultAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS * 3);
    for (const q of office) expect(company.view().questions.find((x) => x.id === q.id)?.withdrawn?.reason ?? '').not.toContain('Nobody answered in time');
  });

  it('is set again after a restart, and applies at once when its time passed while the office was down', async () => {
    const { company, reopen, desks } = await running();
    const q = company.askStakeholder('ceo', { ...Q, safe: true });
    await company.close();
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS + 1_000);
    const reopened = await reopen();
    await vi.advanceTimersByTimeAsync(1);
    expect(reopened.view().questions.find((x) => x.id === q.id)?.answer).toMatchObject({ option: 1, byDefault: true });
    expect(desks).toBeDefined();
  });
});

describe('an approval carries its advice, and no answer is a no with what to do instead', () => {
  it('keeps the policy\'s advice with the request', async () => {
    const { company } = await running();
    void company.requestApproval('frontend-engineer', push());
    expect(company.view().approvals.at(-1)?.advice).toEqual({ recommend: 'deny', why: 'Nothing is pushed from inside a company.', fallback: 'Carry on without pushing.', ifNoAnswer: 'deny' });
  });

  it('answers a no that says it was nobody\'s answer, with the fallback', async () => {
    const { company } = await running();
    const answer = company.requestApproval('frontend-engineer', push({ expiresAt: Date.now() + 60_000 }));
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(answer).resolves.toMatchObject({ decision: 'deny', expired: true, fallback: 'Carry on without pushing.' });
  });

  it('keeps nothing from a request that sends no advice', async () => {
    const { company } = await running();
    void company.requestApproval('frontend-engineer', push({ advice: undefined }));
    expect(company.view().approvals.at(-1)).not.toHaveProperty('advice');
  });
});

describe('a question is safe only when the office agrees', () => {
  it.each([
    'Pay for the premium icon set?',
    'Publish the beta today?',
    'Push the branch to the shared repository?',
    'Delete the old menu pages?',
    'Send the opening email to customers?',
    'Use the production domain?',
  ])('never takes a pick by itself on "%s", whatever the asker says', async (text) => {
    const { company } = await running();
    company.askStakeholder('ceo', { text, options: ['Yes', 'No'], recommended: 1, taskId: null, safe: true });
    expect(company.view().questions.at(-1)?.safe).toBe(false);
    await vi.advanceTimersByTimeAsync(QUESTION_WAIT_MS);
    expect(company.view().questions.at(-1)?.answer).toBeNull();
  });

  it('looks at the options too', async () => {
    const { company } = await running();
    company.askStakeholder('ceo', { text: 'Which header?', options: ['Navy header', 'Delete the header'], recommended: 0, taskId: null, safe: true });
    expect(company.view().questions.at(-1)?.safe).toBe(false);
  });

  it('keeps a plain design question as asked', async () => {
    const { company } = await running();
    company.askStakeholder('ceo', { text: 'Which blue for the buttons?', options: ['Navy', 'Teal'], recommended: 1, taskId: null, safe: true });
    expect(company.view().questions.at(-1)?.safe).toBe(true);
  });
});

describe('one press never lets a connector through', () => {
  it('answers no to a connector tool whose advice says allow, and yes to a plain ask the policy advised', async () => {
    const { company } = await running();
    const advice = { recommend: 'allow' as const, why: 'It only looks things up.', fallback: 'Carry on.', ifNoAnswer: 'deny' as const };
    const connector = company.requestApproval('ux-designer', push({ tool: 'mcp__x__get_and_run', kind: 'other', summary: 'Use x to get and run', advice }));
    const plain = company.requestApproval('frontend-engineer', push({ kind: 'other', summary: 'Run a program', advice }));
    company.askStakeholder('ceo', { ...Q });
    const done = company.answerBatch(company.view().questions.at(-1)?.batch ?? '');
    expect(done.approvals.map((x) => [x.tool, x.answer?.decision])).toEqual([['mcp__x__get_and_run', 'deny'], ['Bash', 'allow']]);
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await expect(connector).resolves.toMatchObject({ decision: 'deny' });
    await expect(plain).resolves.toMatchObject({ decision: 'allow' });
  });
});

describe('batches', () => {
  it('put asks raised close together in one, across questions and approvals, and start another after the window', async () => {
    const { company } = await running();
    const a = company.askStakeholder('ceo', { ...Q });
    await vi.advanceTimersByTimeAsync(10_000);
    void company.requestApproval('frontend-engineer', push());
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 20_000);
    const b = company.askStakeholder('ceo', { text: 'Which font?', options: ['Serif', 'Sans'], recommended: 0, taskId: null });
    const view = company.view();
    expect(view.questions.find((q) => q.id === a.id)?.batch).toBe(a.id);
    expect(view.approvals.at(-1)?.batch).toBe(a.id);
    expect(view.questions.find((q) => q.id === b.id)?.batch).toBe(a.id);
    expect(view.batches).toEqual([{ id: a.id, at: expect.any(Number), items: [{ kind: 'question', id: a.id }, { kind: 'question', id: b.id }, { kind: 'approval', id: view.approvals.at(-1)?.id }] }]);
    // The window counts from the newest ask still waiting.
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 1);
    const c = company.askStakeholder('ceo', { text: 'Which icon?', options: ['Line', 'Solid'], recommended: 0, taskId: null });
    expect(company.view().questions.find((q) => q.id === c.id)?.batch).toBe(c.id);
    expect(company.view().batches?.map((batch) => batch.id)).toEqual([a.id, c.id]);
  });

  it('start a new one when the ones before were answered', async () => {
    const { company } = await running();
    const a = company.askStakeholder('ceo', { ...Q });
    company.answer(a.id, { option: 0, text: '' });
    const b = company.askStakeholder('ceo', { text: 'Which font?', options: ['Serif', 'Sans'], recommended: 0, taskId: null });
    expect(company.view().questions.find((q) => q.id === b.id)?.batch).toBe(b.id);
  });

  it('take one press: each question its pick, each approval its recommendation, and what has no pick stays', async () => {
    const { company, desks } = await running();
    const a = company.askStakeholder('ceo', { ...Q });
    const b = company.askStakeholder('ceo', { text: 'Which font?', options: ['Serif', 'Sans'], recommended: null, taskId: null });
    const denied = company.requestApproval('frontend-engineer', push());
    const allowed = company.requestApproval('ux-designer', push({ summary: 'Use docs to search', kind: 'other', advice: { recommend: 'allow', why: 'It only looks things up.', fallback: 'Carry on.', ifNoAnswer: 'deny' } }));
    const done = company.answerBatch(a.id);
    expect(done.questions.map((q) => [q.id, q.answer?.option])).toEqual([[a.id, 1]]);
    expect(done.approvals.map((x) => x.answer?.decision)).toEqual(['deny', 'allow']);
    expect(done.approvals.every((x) => x.answer?.always === false)).toBe(true);
    expect(done.left).toEqual([b.id]);
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await expect(denied).resolves.toMatchObject({ decision: 'deny' });
    await expect(allowed).resolves.toMatchObject({ decision: 'allow', always: false });
    expect(desks().textsFor('ceo').at(-1)).toBe('From Robin, the stakeholder: on "Which blue?": Teal.');
    expect(company.view().inbox).toBe(1);
    expect(company.view().batches?.[0]?.items).toEqual([{ kind: 'question', id: b.id }]);
  });

  it('refuse a batch with nothing left in it', async () => {
    const { company } = await running();
    expect(refusal(() => company.answerBatch('q-404')).code).toBe('unknown');
    const a = company.askStakeholder('ceo', { ...Q });
    company.answer(a.id, { option: 0, text: '' });
    expect(refusal(() => company.answerBatch(a.id)).code).toBe('unknown');
  });
});

describe('the plan that waits for approval, in everyday words', () => {
  it('says the size, what starts first, how many tasks and what it should cost; and goes once it is approved', async () => {
    const r = await rig({ running: true, now: () => Date.now(), planApproval: 'before-work', org: { size: 'small' } });
    expect(r.company.view().planSummary).toBeNull();
    const proposed = r.company.proposePlan('ceo', withChecklist(PLAN));
    if (!proposed.ok) throw new Error(proposed.errors.join('\n'));
    const summary = r.company.view().planSummary;
    expect(summary).toMatchObject({ version: 1, size: 'small', tasks: 2, milestones: 2, makers: 1, first: [{ title: 'Menu data', owner: expect.any(String) }] });
    expect(summary?.words).toMatch(/^2 tasks in 2 milestones, by a small company: the CEO and one maker/);
    expect(summary?.words).toContain('It starts with Menu data (');
    expect(summary?.estimate === null || (summary?.estimate.low ?? 0) <= (summary?.estimate.high ?? 0)).toBe(true);
    if (summary?.estimate) expect(summary.words).toMatch(/It should cost about \$[\d.]+ to \$[\d.]+ and take /);
    r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
    expect(r.company.view().planSummary).toBeNull();
  });
});
