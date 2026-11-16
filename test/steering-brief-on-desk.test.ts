// A brief the switchboard already wrote to a busy desk can't be taken back. When the task is then cancelled, paused or
// given to someone else, its owner is told to stop, as if they had started it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { fenced, rig, type Rig } from './company-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const heardBy = (r: Rig, person: string) => [...r.desks().turns, ...r.desks().stops].filter((t) => t.plan.person.id === person).map((t) => fenced(t).words);

async function inFlight(canWithdraw: boolean) {
  const r = await rig({ running: true, planApproval: 'off' });
  const task = r.company.createTask(STAKEHOLDER, { title: 'Fix the footer', brief: 'It overlaps.', files: ['src/Footer.tsx'], owner: 'ui-designer', doneWhen: 'It fits.', milestone: null, cites: [] });
  // The switchboard wrote it into the person's running turn: it isn't taken yet, and it can't come back.
  r.desks().canWithdraw = canWithdraw;
  r.desks().views = [{ person: 'ui-designer', state: 'working', sessionId: null, since: 0, context: null, problem: null, queue: null }];
  return { r, task, before: heardBy(r, 'ui-designer').length };
}

describe('a task whose brief is already on its owner desk', () => {
  it('tells the owner when it is cancelled', async () => {
    const { r, task, before } = await inFlight(false);
    r.company.steerTask(STAKEHOLDER, { action: 'cancel', task: task.id, reason: 'Wrong person.', cites: [] });
    expect(heardBy(r, 'ui-designer').slice(before).some((w) => w.includes('cancelled'))).toBe(true);
  });

  it('tells the owner when it is paused', async () => {
    const { r, task, before } = await inFlight(false);
    r.company.steerTask(STAKEHOLDER, { action: 'pause', task: task.id, cites: [] });
    expect(heardBy(r, 'ui-designer').slice(before).some((w) => w.includes('paused'))).toBe(true);
  });

  it('tells the old owner when it is reassigned', async () => {
    const { r, task, before } = await inFlight(false);
    r.company.steerTask(STAKEHOLDER, { action: 'reassign', task: task.id, to: 'ux-designer', note: 'Lea has it.', cites: [] });
    expect(heardBy(r, 'ui-designer').slice(before).some((w) => w.includes('moved'))).toBe(true);
  });

  it('says nothing when the switchboard takes the brief back', async () => {
    const { r, task, before } = await inFlight(true);
    r.company.steerTask(STAKEHOLDER, { action: 'cancel', task: task.id, reason: 'Wrong person.', cites: [] });
    expect(heardBy(r, 'ui-designer').slice(before)).toEqual([]);
  });
});
