// A task the stakeholder put on the board themself is approved work: it can be split into parts before any plan is
// approved. One the CEO put there on the stakeholder's word is not: the stakeholder asked for a task, not for its work
// to start before the plan they approve, so its parts wait for the plan like any other work.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { rig } from './company-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const PAYMENTS = { title: 'Card payments', brief: 'Add card payments.', files: ['src/pay'], owner: 'frontend-engineer', doneWhen: 'A card payment goes through.', milestone: null };
const part = (parent: string) => ({ to: 'frontend-engineer', title: 'Payment keys', brief: 'Wire the keys.', files: ['src/pay/keys'], doneWhen: 'The keys load.', parent, milestone: null, worktree: false });
const later = () => vi.advanceTimersByTime(1_000);

describe("a task made on the stakeholder's word", () => {
  it('is not split before a plan is approved, though the stakeholder typed the request', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    const asked = r.company.say('ceo', 'Please add card payments for Sam.', { typed: true });
    later();
    const task = r.company.createTask('ceo', { ...PAYMENTS, cites: [asked.id] });
    expect(task).toMatchObject({ askedBy: STAKEHOLDER, cites: [asked.id] });
    expect(() => r.company.assign('ceo', part(task.id))).toThrow(/Work starts from the plan here/);
    expect(r.company.view().tasks.filter((t) => t.parent === task.id)).toEqual([]);
  });

  it('stays the stakeholder own when the CEO steers it on their word, so it can still be split', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    const task = r.company.createTask(STAKEHOLDER, { ...PAYMENTS, cites: [] });
    later();
    const pause = r.company.say('ceo', 'Pause the payments task for now.', { typed: true });
    later();
    r.company.steerTask('ceo', { action: 'pause', task: task.id, cites: [pause.id] });
    later();
    const resume = r.company.say('ceo', 'Go on with payments.', { typed: true });
    later();
    const [resumed] = r.company.steerTask('ceo', { action: 'resume', task: task.id, cites: [resume.id] });
    expect(resumed?.cites).toEqual([pause.id, resume.id]);
    expect(r.company.assign('ceo', part(task.id)).parent).toBe(task.id);
  });
});
