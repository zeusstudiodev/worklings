// A task turn handed out again (the board's order changed) still opens its owner's desk in the task's worktree.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import { rig } from './company-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a worktree task turn handed out again', () => {
  it('keeps its worktree as the desk folder when the board order changes', async () => {
    const r = await rig({ running: true, planApproval: 'off' });
    const a = r.company.assign('head-of-design', { to: 'ui-designer', title: 'Buttons', brief: 'Chalk buttons.', files: ['src/a'], doneWhen: 'They match.', parent: null, milestone: null, worktree: false });
    r.desks().deliverAll();
    const b = r.company.assign('head-of-design', { to: 'ui-designer', title: 'Menu board', brief: 'The board.', files: ['src/b'], doneWhen: 'It reads.', parent: null, milestone: null, worktree: true });
    await r.company.idle();
    const turnsOf = (id: string) => r.desks().turns.filter((t) => t.turn.text.includes(id));
    const first = turnsOf(b.id).at(-1);
    const worktree = r.company.view().tasks.find((t) => t.id === b.id)?.worktree?.path;
    expect(worktree).toBeTruthy();
    expect(first?.plan.cwd).toBe(worktree);
    r.company.steerTask(STAKEHOLDER, { action: 'order', tasks: [b.id, a.id], cites: [] });
    const again = r.desks().turns.filter((t) => t.turn.messageId === first?.turn.messageId);
    expect(again.length).toBeGreaterThan(1);
    expect(again.at(-1)?.plan.cwd).toBe(worktree);
  });
});
