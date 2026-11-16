import { describe, expect, it } from 'vitest';
import { isOpenTask } from '../src/core/company-state.ts';
import { STAKEHOLDER } from '../src/core/company.ts';
import { demoPausedView, demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import { managerProblem } from '../src/core/org.ts';
import { checkPlan } from '../src/core/plan.ts';
import { PLAN_LIMITS } from '../src/core/steering.ts';
import { boardOf, COLUMNS } from '../web/src/company/tasks/board/columns.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);

describe('Ledger, the demo’s paused company, at forty people', () => {
  const ledger = demoPausedView(NOW);
  const byId = new Map(ledger.people.map((p) => [p.id, p]));

  it('is the same for the same moment', () => {
    expect(demoPausedView(NOW)).toEqual(ledger);
  });

  it('has forty people in eight rooms, each with a first name, and two who share one', () => {
    expect(ledger.people).toHaveLength(40);
    expect(new Set(ledger.people.map((p) => p.id)).size).toBe(40);
    expect(new Set(ledger.people.map((p) => p.room)).size).toBe(8);
    for (const p of ledger.people) expect(p.name, p.id).toMatch(/^[A-Z][a-z]+$/);
    const names = ledger.people.map((p) => p.name);
    const shared = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    expect(shared.map((name) => [name, ledger.people.filter((p) => p.name === name).map((p) => p.title)])).toEqual([['Nils', ['Backend engineer', 'DevOps engineer']]]);
    expect(Math.max(...ledger.people.map((p) => p.title.length))).toBeGreaterThan(40);
  });

  it("follows the org's reporting rules: one CEO, heads to the CEO, leads to a head, workers to anyone above, a lead in a room of more than six", () => {
    expect(ledger.people.filter((p) => p.level === 'ceo')).toHaveLength(1);
    for (const p of ledger.people) {
      if (p.level === 'ceo') {
        expect(p.reportsTo).toBeNull();
        continue;
      }
      const manager = p.reportsTo ? byId.get(p.reportsTo) : undefined;
      expect(manager, `${p.id} reports to someone in the company`).toBeDefined();
      expect(managerProblem(p.level, manager?.id ?? '', manager?.level ?? 'worker'), p.id).toBeNull();
    }
    for (const room of new Set(ledger.people.map((p) => p.room))) {
      const inRoom = ledger.people.filter((p) => p.room === room);
      if (inRoom.length > 6) expect(inRoom.some((p) => p.level === 'lead'), `${room} has a lead`).toBe(true);
    }
    expect(studioOf(ledger).roles).toHaveLength(40);
    expect(demoSnapshot(ledger, 'C:\\x', NOW).studio?.roles).toHaveLength(40);
  });

  it('has about a hundred tasks, every board column populated, and every one owned by someone there', () => {
    expect(ledger.tasks.length).toBeGreaterThanOrEqual(95);
    expect(ledger.tasks.length).toBeLessThanOrEqual(110);
    expect(new Set(ledger.tasks.map((t) => t.id)).size).toBe(ledger.tasks.length);
    const board = boardOf(ledger, ledger.tasks.filter(isOpenTask).map((t) => t.id), NOW);
    expect(board.columns.map((c) => c.id)).toEqual(COLUMNS.map((c) => c.id));
    for (const c of board.columns) expect(c.cards.length, c.title).toBeGreaterThan(0);
    for (const t of ledger.tasks) {
      expect(byId.has(t.owner), `${t.id}'s owner`).toBe(true);
      expect(t.askedBy === STAKEHOLDER || byId.has(t.askedBy), `${t.id} was asked for by someone there`).toBe(true);
      expect(t.createdAt, t.id).toBeLessThanOrEqual(t.updatedAt);
      expect(t.updatedAt, t.id).toBeLessThanOrEqual(NOW);
    }
  });

  it('has a plan the office accepts, with the board’s tasks made from it and a milestone only the plan holds', () => {
    const plan = ledger.steering?.plan?.versions[0]?.plan;
    if (!plan) throw new Error('Ledger has no plan');
    const checked = checkPlan(plan, ledger.people);
    expect(checked.ok, checked.ok ? '' : checked.errors.join(' | ')).toBe(true);
    expect(plan.tasks.length).toBeLessThanOrEqual(PLAN_LIMITS.tasks);
    expect(plan.milestones).toHaveLength(4);
    const fromPlan = ledger.tasks.filter((t) => t.planTask);
    for (const t of fromPlan) expect(plan.tasks.find((p) => p.id === t.planTask), t.id).toMatchObject({ title: t.title, owner: t.owner, milestone: t.milestone });
    expect(ledger.tasks.some((t) => !t.planTask)).toBe(true);
    const last = plan.milestones.at(-1)?.id;
    expect(plan.tasks.some((p) => p.milestone === last)).toBe(true);
    expect(ledger.tasks.some((t) => t.milestone === last)).toBe(false);
    expect(ledger.steering?.plan?.approved).toMatchObject({ version: 1, through: 'lms-reports' });
    expect(ledger.steering?.plan?.waiting).toBeNull();
  });

  it('never starts a task before what it waits for is done or on its way', () => {
    const plan = ledger.steering?.plan?.versions[0]?.plan;
    const status = new Map(ledger.tasks.flatMap((t) => (t.planTask ? [[t.planTask, t] as const] : [])));
    for (const p of plan?.tasks ?? []) {
      const t = status.get(p.id);
      if (!t || (t.status !== 'done' && t.status !== 'working' && t.status !== 'review')) continue;
      for (const after of p.after) {
        const before = status.get(after);
        expect(before === undefined || before.status === 'done' || before.status === 'working' || before.status === 'review', `${p.title} follows ${after}`).toBe(true);
        if (t.status === 'done') expect(before?.status, `${p.title} is done, so ${after} is`).toBe('done');
      }
    }
  });

  it("marks its first milestone done and puts what waits for you in the inbox", () => {
    expect(ledger.goal?.milestones.map((m) => m.doneAt !== null)).toEqual([true, false, false, false]);
    for (const t of ledger.tasks.filter((x) => x.milestone === 'lms-read')) expect(t.status, t.id).toBe('done');
    expect(ledger.inbox).toBe(ledger.questions.length);
    for (const q of ledger.questions) expect(q.taskId === null || ledger.tasks.some((t) => t.id === q.taskId), q.id).toBe(true);
    expect(ledger.pause?.reason).toBe('stakeholder');
  });
});
