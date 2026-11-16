// Paused stays paused: after the hub restarts, and when a person is brought back from Claude Code, nobody is told to
// carry on with a task the stakeholder paused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER, type Task } from '../src/core/company.ts';
import { crashCopy, fenced, rig, type Rig } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});
const settled = () => vi.advanceTimersByTimeAsync(0);

const PLAN = {
  goal: 'A bilingual cafe website with pickup orders.',
  milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'The menu reads well on a phone.' }],
  tasks: [
    { id: 'p-1', title: 'Menu data', owner: 'frontend-engineer', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' },
    { id: 'p-2', title: 'Menu look', owner: 'ui-designer', files: ['src/styles'], milestone: 'ms-1', after: [], brief: 'The chalk style.', doneWhen: 'It matches.', check: 'npm test' },
  ],
  note: null,
  cites: [] as string[],
};

async function pausedMenu(): Promise<{ r: Rig; menu: Task }> {
  const r = await rig({ running: true, planApproval: 'before-work' });
  r.company.proposePlan('ceo', withChecklist(PLAN));
  r.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
  r.desks().deliverAll();
  await settled();
  const menu = r.company.view().tasks.find((t) => t.planTask === 'p-1' && t.status !== 'dropped');
  if (!menu) throw new Error('no task for p-1');
  expect(menu.status).toBe('working');
  r.company.steerTask(STAKEHOLDER, { action: 'pause', task: menu.id, cites: [] });
  r.desks().deliverAll();
  return { r, menu };
}

describe('a paused task', () => {
  it('is not handed back to its owner as work to carry on with after a restart', async () => {
    const { r, menu } = await pausedMenu();
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      await settled();
      const heard = (r.boards.at(-1)?.turns ?? []).filter((t) => t.plan.person.id === 'frontend-engineer').map((t) => fenced(t).words);
      expect(again.view().tasks.find((t) => t.id === menu.id)?.paused).toBeTruthy();
      expect(heard.some((w) => w.includes('Menu data'))).toBe(false);
    } finally {
      await again.close();
    }
  });

  it('is not handed back to a brought-back owner as work to carry on with', async () => {
    const { r } = await pausedMenu();
    r.company.handOver('frontend-engineer');
    const before = r.desks().turns.length;
    r.company.bringBack('frontend-engineer');
    const heard = r.desks().turns.slice(before).filter((t) => t.plan.person.id === 'frontend-engineer').map((t) => fenced(t).words);
    expect(heard.some((w) => w.includes('Menu data'))).toBe(false);
  });

  it('still tells the owner of a task that is not paused to carry on after a restart', async () => {
    const { r } = await pausedMenu();
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      await settled();
      const heard = (r.boards.at(-1)?.turns ?? []).filter((t) => t.plan.person.id === 'ui-designer').map((t) => fenced(t).words);
      expect(heard.some((w) => w.includes('Menu look'))).toBe(true);
    } finally {
      await again.close();
    }
  });
});
