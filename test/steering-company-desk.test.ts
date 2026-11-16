// Steering through a real company and the real switchboard with the fake Claude Code (test/fake-desk.mjs): nothing of
// a plan reaches a desk before Approve, its tasks then reach their owners' desks in the board's order when only one desk
// may run at a time, and pausing a task interrupts its owner's turn and holds the task until it resumes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCompany } from '../src/company/index.ts';
import { type DeskControl, type DeskEvents, STAKEHOLDER } from '../src/core/company.ts';
import { createSwitchboard } from '../src/runtime/index.ts';
import { fakeGit, fakeOrg, KEY, newProject, proposal } from './company-kit.ts';
import { tempDir } from './library-kit.ts';
import { alive, FAKE_DESK, fakeHub, type FakeLogEntry, until } from './runtime-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

const PLAN = {
  goal: 'A bilingual café website with pickup orders.',
  milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'The menu reads well on a phone.' }],
  tasks: [
    { id: 'p-1', title: 'Menu data', owner: 'frontend-engineer', files: ['src/menu'], milestone: 'ms-1', after: [], brief: '[fake:busy] The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' },
    { id: 'p-2', title: 'Menu look', owner: 'ui-designer', files: ['src/styles'], milestone: 'ms-1', after: [], brief: 'The chalk style.', doneWhen: 'It matches.', check: 'npm test' },
    { id: 'p-3', title: 'Menu flow', owner: 'ux-designer', files: ['docs/flow.md'], milestone: 'ms-1', after: [], brief: 'Map the menu.', doneWhen: 'Reviewed.', check: 'npm test' },
  ],
  note: null,
  cites: [] as string[],
};

async function setup(o: { maxDesks: number; script: object }) {
  const dir = tempDir('worklings-steering-desk-');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  const logFile = join(dir, 'desk.jsonl');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(o.script));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE'].includes(k.toUpperCase()))),
    WORKLINGS_CLAUDE: FAKE_DESK,
    FAKE_DESK_SCRIPT: scriptFile,
    FAKE_DESK_LOG: logFile,
    FAKE_DESK_SESSIONS: join(dir, 'sessions'),
  };
  const hub = await fakeHub();
  const root = newProject();
  const company = createCompany({
    key: KEY,
    org: fakeOrg(),
    git: fakeGit(),
    warn: () => {},
    desks: (events: DeskEvents, companyId: string): DeskControl => createSwitchboard({ companyId, root, hub, events, maxDesks: o.maxDesks, idleMs: 60_000, env, claude: FAKE_DESK, scratch }),
    root,
    prompt: 'A bilingual café website with pickup orders.',
    stakeholder: 'Robin',
  });
  // The company applies its own setting to the switchboard when it opens, so the cap is set there, not only on the board.
  company.updateSettings({ maxDesks: o.maxDesks });
  // These tests are about the plan before Approve; new companies start with plan approval off until H39.
  company.changeSettings(STAKEHOLDER, { planApproval: 'before-work', cites: [] });
  const log = (): FakeLogEntry[] => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry) : []);
  const close = async () => {
    await company.close();
    await hub.close();
    const pids = log().flatMap((e) => (e.event === 'start' ? [e.pid] : []));
    await until(() => pids.every((pid) => !alive(pid)), 10_000, 'the desks to be gone');
  };
  const proposed = company.proposeOrg('ceo', proposal());
  if (!proposed.ok) throw new Error(proposed.errors.join('; '));
  company.start();
  await company.idle();
  await until(() => company.view().messages.some((m) => m.to === 'ceo' && m.from !== STAKEHOLDER && m.deliveredAt !== null && m.text.includes('started the company')), 30_000, "the CEO's start turn");
  return { company, log, close };
}

const assignmentOf = (company: ReturnType<typeof createCompany>, planTask: string) => {
  const task = company.view().tasks.find((t) => t.planTask === planTask);
  return company.view().messages.find((m) => m.to === task?.owner && task !== undefined && m.text.startsWith(`New task ${task.id}`));
};

describe('the plan on real desks', () => {
  it("opens no desk for the plan before Approve, then hands its tasks out in the board's order, one desk at a time", async () => {
    const s = await setup({ maxDesks: 1, script: { default: [{ say: 'On it.' }] } });
    try {
      s.company.proposePlan('ceo', withChecklist(PLAN));
      await new Promise((done) => setTimeout(done, 500));
      expect(s.log().filter((e) => e.event === 'start')).toHaveLength(1);
      expect(s.company.view().tasks).toEqual([]);
      s.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
      await until(() => ['p-1', 'p-2', 'p-3'].every((p) => assignmentOf(s.company, p)?.deliveredAt != null), 90_000, "the plan's turns to reach their desks");
      const delivered = ['p-1', 'p-2', 'p-3'].map((p) => assignmentOf(s.company, p)?.deliveredAt ?? 0);
      expect([...delivered].sort((a, b) => a - b)).toEqual(delivered);
    } finally {
      await s.close();
    }
  }, 120_000);

  it("pauses a task by interrupting its owner's turn, holds it, and resumes it", async () => {
    const s = await setup({ maxDesks: 4, script: { scenarios: { busy: [{ wait: 60_000 }, { say: 'Built the menu data.' }] }, default: [{ say: 'On it.' }] } });
    try {
      s.company.proposePlan('ceo', withChecklist(PLAN));
      s.company.approvePlan(STAKEHOLDER, { version: 1, through: null, cites: [] });
      await until(() => s.company.view().people.find((p) => p.id === 'frontend-engineer')?.desk.state === 'working', 30_000, 'Sam to be at work on the menu data');
      const menu = s.company.view().tasks.find((t) => t.planTask === 'p-1');
      if (!menu) throw new Error('No task for the menu data.');
      s.company.steerTask(STAKEHOLDER, { action: 'pause', task: menu.id, cites: [] });
      const stop = s.company.view().messages.findLast((m) => m.to === 'frontend-engineer' && m.interrupt);
      expect(stop?.text).toBe(`Robin paused task ${menu.id}, “Menu data”. Stop work on it now and wait: you'll hear when it resumes.`);
      await until(() => s.company.view().messages.find((m) => m.id === stop?.id)?.deliveredAt != null, 30_000, 'the stop to reach Sam');
      expect(s.log().filter((e) => e.event === 'interrupt')).toHaveLength(1);
      expect(s.company.view().tasks.find((t) => t.id === menu.id)?.paused).toMatchObject({ by: STAKEHOLDER });
      s.company.steerTask(STAKEHOLDER, { action: 'resume', task: menu.id, cites: [] });
      await until(() => s.company.view().messages.some((m) => m.to === 'frontend-engineer' && m.text.startsWith(`Robin resumed task ${menu.id}`) && m.deliveredAt !== null), 30_000, 'the resume to reach Sam');
    } finally {
      await s.close();
    }
  }, 120_000);
});
