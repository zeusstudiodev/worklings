// The CEO acts "as you asked" only on words the stakeholder typed into a box in the office. The office also sends
// messages in the stakeholder's name that nobody typed: the default words of a plain Stop, the text of a button (Stop
// and wait, "ask for a plan", "draft the org again"), and every message kept from before typed words were marked.
// None of them can be cited as the stakeholder's word, for a plan's approval, a setting, a task or a revision.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyEvent } from '../src/core/company-state.ts';
import type { Message } from '../src/core/company.ts';
import { openStore } from '../src/company/store.ts';
import { KEY, type Rig, rig, STAKEHOLDER } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const PLAN = {
  goal: 'A bilingual cafe website with pickup orders.',
  milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'The menu reads well on a phone.' }],
  tasks: [{ id: 'p-1', title: 'Menu data', owner: 'frontend-engineer', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' }],
  note: null,
  cites: [] as string[],
};
const NEW_TASK = { title: 'Card payments', brief: 'Add card payments.', files: ['src/pay'], owner: 'frontend-engineer', doneWhen: 'A card payment goes through.', milestone: null };
/** What the web's buttons send: the person panel's Stop and wait, and the plan tab's "ask for a plan". */
const STOP_AND_WAIT = 'Stop here and wait for my next message.';
const ASK_FOR_PLAN = 'Please propose a plan for my approval: the goal, the milestones and the tasks, with who does each.';
const NOT_TYPED = /not something .* typed/;

const later = () => vi.advanceTimersByTime(1_000);

async function withPlan(): Promise<Rig> {
  const r = await rig({ running: true, planApproval: 'before-work' });
  const proposed = r.company.proposePlan('ceo', withChecklist(PLAN));
  if (!proposed.ok) throw new Error(proposed.errors.join('\n'));
  later();
  return r;
}

describe('words the office sends in the stakeholder name are not their word', () => {
  it('a plain Stop, whose words are the office default, approves no plan and changes no setting', async () => {
    const r = await withPlan();
    const stop = r.company.stop('ceo', '');
    expect(stop.text).toBe(STOP_AND_WAIT);
    later();
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [stop.id] })).toThrow(NOT_TYPED);
    expect(() => r.company.changeSettings('ceo', { planApproval: 'off', cites: [stop.id] })).toThrow(NOT_TYPED);
    expect(r.company.view().tasks).toHaveLength(0);
    expect(r.company.view().steering?.settings.planApproval).toBe('before-work');
  });

  it('a plain Stop stays unmarked even when the request says typed: the default words are still the office', async () => {
    const r = await withPlan();
    const stop = r.company.stop('ceo', '   ', { typed: true });
    expect(stop.typed).toBeUndefined();
    later();
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [stop.id] })).toThrow(NOT_TYPED);
  });

  it('the Stop and wait button, which sends its own words, approves no plan', async () => {
    const r = await withPlan();
    const stop = r.company.stop('ceo', STOP_AND_WAIT);
    later();
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [stop.id] })).toThrow(NOT_TYPED);
    expect(r.company.view().tasks).toHaveLength(0);
  });

  it('a button that sends its words as a message puts no task on the board and approves no plan', async () => {
    const r = await withPlan();
    const asked = r.company.say('ceo', ASK_FOR_PLAN);
    later();
    expect(() => r.company.createTask('ceo', { ...NEW_TASK, cites: [asked.id] })).toThrow(NOT_TYPED);
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [asked.id] })).toThrow(NOT_TYPED);
    expect(r.company.view().tasks).toHaveLength(0);
  });

  it('a send to the CEO without the mark counts no more than a message', async () => {
    const r = await withPlan();
    const [sent] = r.company.send(STAKEHOLDER, { to: { kind: 'person', id: 'ceo' }, text: 'Approve it.', for: [] });
    later();
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [sent?.id ?? ''] })).toThrow(NOT_TYPED);
  });

  it('a revision lists no cite of words nobody typed', async () => {
    const r = await withPlan();
    const asked = r.company.say('ceo', ASK_FOR_PLAN);
    later();
    const revised = r.company.proposePlan('ceo', withChecklist({ ...PLAN, goal: 'A bilingual cafe website.', cites: [asked.id] }));
    expect(revised.ok && revised.version.cites).toEqual([]);
  });

  it('a person in the company never marks a message typed, whatever their send says', async () => {
    const r = await rig({ running: true });
    const copies = r.company.send('ceo', { to: { kind: 'person', id: 'head-of-design' }, text: 'Darker palette.', for: [], typed: true });
    expect(copies.every((m) => m.typed === undefined)).toBe(true);
  });
});

describe('words the stakeholder typed are their word', () => {
  it('a typed message approves the plan, and the decision names it', async () => {
    const r = await withPlan();
    const said = r.company.say('ceo', 'Looks right, approve it.', { typed: true });
    expect(said.typed).toBe(true);
    later();
    r.company.approvePlan('ceo', { version: 1, through: null, cites: [said.id] });
    expect(r.company.view().tasks.length).toBeGreaterThan(0);
    expect(r.company.view().steering?.decisions.filter((d) => d.kind === 'plan').at(-1)?.links.message).toBe(said.id);
  });

  it('a Stop with an instruction the stakeholder typed changes a setting', async () => {
    const r = await withPlan();
    const stop = r.company.stop('ceo', 'Stop asking me about every plan: turn plan approval off.', { typed: true });
    expect(stop.typed).toBe(true);
    later();
    r.company.changeSettings('ceo', { planApproval: 'off', cites: [stop.id] });
    expect(r.company.view().steering?.settings.planApproval).toBe('off');
  });

  it('a typed send to the CEO puts the task it asks for on the board', async () => {
    const r = await rig({ running: true });
    const [sent] = r.company.send(STAKEHOLDER, { to: { kind: 'person', id: 'ceo' }, text: 'Add card payments for Sam.', for: [], typed: true });
    expect(sent?.typed).toBe(true);
    later();
    const made = r.company.createTask('ceo', { ...NEW_TASK, cites: [sent?.id ?? ''] });
    expect(made.cites).toEqual([sent?.id]);
  });

  it('a revision lists the typed message it answers', async () => {
    const r = await withPlan();
    const said = r.company.say('ceo', 'Make the goal shorter.', { typed: true });
    later();
    const revised = r.company.proposePlan('ceo', withChecklist({ ...PLAN, goal: 'A bilingual cafe website.', cites: [said.id] }));
    expect(revised.ok && revised.version.cites).toEqual([said.id]);
  });
});

describe('messages kept from before typed words were marked', () => {
  /** Writes `messages` into the company's log as lines of a log from before this change, then opens it again. */
  async function fromAnOldLog(r: Rig, messages: Message[]) {
    await r.company.close();
    const store = openStore({ root: r.root, key: KEY, warn: () => undefined });
    store.append(messages.map((message): CompanyEvent => ({ type: 'message', message })));
    store.close();
    return r.reopen();
  }
  const old = (id: string, text: string, extra: Partial<Message> = {}): Message => ({
    id, from: STAKEHOLDER, to: 'ceo', text, origin: null, relayOf: null, note: null, at: Date.now(), deliveredAt: Date.now(), interrupt: false, answers: null, ...extra,
  });

  it('a message from such a log approves no plan: the mark is missing, so it fails closed', async () => {
    const r = await withPlan();
    const again = await fromAnOldLog(r, [old('m-900', 'Yes, approve the plan.')]);
    try {
      expect(again.view().messages.find((m) => m.id === 'm-900')).toBeDefined();
      expect(() => again.approvePlan('ceo', { version: 1, through: null, cites: ['m-900'] })).toThrow(NOT_TYPED);
      expect(again.view().tasks).toHaveLength(0);
    } finally {
      await again.close();
    }
  });

  it("an answer from before answers were marked the office's counts as the office's note", async () => {
    const r = await withPlan();
    const again = await fromAnOldLog(r, [old('m-901', 'on "Approve the plan?": Yes.', { answers: 'q-9' })]);
    try {
      expect(() => again.approvePlan('ceo', { version: 1, through: null, cites: ['m-901'] })).toThrow(/the office's note/);
    } finally {
      await again.close();
    }
  });
});
