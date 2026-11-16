// A task the stakeholder put on the board is approved work from the start: its owner can split it into parts while a
// plan governs and none is approved yet. Work that isn't a part of one still waits for the plan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { rig } from './company-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('splitting a stakeholder task before the first plan approval', () => {
  it("lets the owner assign parts of it, inside its files, and still refuses work that isn't a part", async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    const task = r.company.createTask(STAKEHOLDER, { title: 'Chalk menu board', brief: 'The board.', files: ['src/board'], owner: 'head-of-design', doneWhen: 'It reads.', milestone: null, cites: [] });
    const part = r.company.assign('head-of-design', { to: 'ui-designer', title: 'Board buttons', brief: 'Chalk buttons.', files: ['src/board/buttons'], doneWhen: 'They match.', parent: task.id, milestone: null, worktree: false });
    expect(part.parent).toBe(task.id);
    expect(() => r.company.assign('head-of-design', { to: 'ui-designer', title: 'Elsewhere', brief: 'Other.', files: ['src/other'], doneWhen: 'Done.', parent: task.id, milestone: null, worktree: false })).toThrow(/isn't inside the files/);
    expect(() => r.company.assign('head-of-design', { to: 'ui-designer', title: 'Loose work', brief: 'Other.', files: ['src/board'], doneWhen: 'Done.', parent: null, milestone: null, worktree: false })).toThrow(/Work starts from the plan here/);
  });
});
