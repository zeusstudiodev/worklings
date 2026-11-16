// scripts/plan-only.mjs as a dry run: the real script, a real hub as a child process, and Claude Code faked
// (test/fake-desk.mjs) by a script in which the CEO is turned down once on its org (a small company with three makers)
// and once on its plan (a task that is only tests, a task with no check, and no final verification), then fixes both.
// The script must report the second round's org and plan, count each refusal with its sentences, and leave the plan
// unapproved so no task starts.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from './library-kit.ts';
import { FAKE_DESK } from './runtime-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

const member = (id: string, name: string, title: string, room: string, owns: string, library: string) => ({ id, name, title, level: 'worker', room, reportsTo: 'ceo', model: 'sonnet', owns, library });
const CEO = { id: 'ceo', name: 'Noor', title: 'CEO', level: 'ceo', room: 'direction', reportsTo: null, model: 'opus', owns: 'The company, its goal and the line to the stakeholder', library: 'ceo' };
const ROOMS = [
  { id: 'direction', title: 'Direction', style: 'direction' },
  { id: 'engineering', title: 'Engineering', style: 'engineering' },
];
const MAKERS = [
  member('frontend-engineer', 'Sam', 'Frontend engineer', 'engineering', 'The screens', 'frontend-engineer'),
  member('backend-engineer', 'Ivo', 'Backend engineer', 'engineering', 'The data and the logic', 'backend-engineer'),
  member('ui-designer', 'Kai', 'UI designer', 'engineering', 'The look', 'ui-designer'),
];
const ORG = { company: 'Dry Co', goal: 'A small app.', theme: 'office', rooms: ROOMS, questions: [] };
/** Three makers called small: refused, with the fix. */
const BAD_ORG = { ...ORG, size: 'small', sizing: 'Three makers, I thought small.', people: [CEO, ...MAKERS] };
const GOOD_ORG = { ...ORG, size: 'medium', sizing: 'Three makers on one small app, flat under me.', people: [CEO, ...MAKERS] };

const MILESTONES = [
  { id: 'ms-1', title: 'Built', doneWhen: 'It works.' },
  { id: 'ms-2', title: 'Reviewed', doneWhen: 'It is reviewed.' },
];
const task = (id: string, title: string, owner: string, extra: Record<string, unknown> = {}) => ({ id, title, owner, files: [`src/${id}/`], milestone: 'ms-1', after: [], brief: `Do ${title}.`, doneWhen: `${title} works.`, ...extra });
/** No check on the first, only tests in the second, no final verification: three problems in one answer. */
const BAD_PLAN = {
  goal: 'A small app.',
  milestones: MILESTONES,
  tasks: [task('p-1', 'Build the app', 'frontend-engineer'), task('p-2', 'Write tests for the app', 'backend-engineer', { check: 'npm test', after: ['p-1'], files: ['test/'] })],
};
const GOOD_PLAN = {
  goal: 'A small app.',
  milestones: MILESTONES,
  tasks: [
    task('p-1', 'Build the app and its tests', 'frontend-engineer', { check: 'npm test' }),
    task('p-2', 'Build the data layer and its tests', 'backend-engineer', { check: 'npm run typecheck && npm test' }),
    task('p-3', 'Review the whole result', 'ceo', { milestone: 'ms-2', files: [], after: ['p-1', 'p-2'], kind: 'verification', doneWhen: 'Each requirement from stakeholder_words has a result.' }),
  ],
};

const SCRIPT = {
  default: [{ say: 'On it.' }],
  byText: [
    { includes: 'First propose the plan with propose_plan', scenario: 'plan' },
    { includes: 'Answers to your scoping questions', scenario: 'found' },
    { includes: 'your first move is ask_scoping', scenario: 'scope' },
  ],
  scenarios: {
    scope: [{ org: 'ask_scoping', arguments: { questions: [{ text: 'Who is it for?', options: ['Just me', 'Anyone'], recommended: 1, why: 'Most tools are for other people too.' }, { text: 'How far?', options: ['A prototype', 'A first release'], recommended: 0, why: 'Small enough to finish.' }] } }, { say: 'Asked.' }],
    found: [{ org: 'propose_org', arguments: BAD_ORG }, { org: 'propose_org', arguments: GOOD_ORG }, { say: 'Proposed an org.' }],
    plan: [{ org: 'propose_plan', arguments: { ...withChecklist(BAD_PLAN), note: 'First try.' } }, { org: 'propose_plan', arguments: { ...withChecklist(GOOD_PLAN), note: 'Second try.' } }, { say: 'Proposed a plan.' }],
  },
};

interface Report {
  org: { size: string | null; people: { id: string }[] } | null;
  plan: { version: number; tasks: { id: string; check: string | null; kind: string | null; owner: string }[] } | null;
  refusals: { org: { count: number; errors: string[] }[]; plan: { count: number; errors: string[] }[] };
  notes: { org: { notes: string[] }[]; plan: { notes: string[] }[] };
  failure: string | null;
  dryRun: boolean;
}

function run(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve('scripts', 'plan-only.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

describe('plan-only, as a dry run with a fake desk', () => {
  it('reports the org and the plan the CEO ended with, counts each refusal with its sentences, approves nothing and cleans up', { timeout: 180_000 }, async () => {
    const dir = tempDir('worklings-plan-only-');
    const scriptFile = join(dir, 'script.json');
    writeFileSync(scriptFile, JSON.stringify(SCRIPT));
    const gitconfig = join(dir, 'gitconfig');
    writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
    const jsonFile = join(dir, 'report.json');
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('plan-only-'));
    const result = await run(['--prompt', 'A small app for tracking plants.', '--json', jsonFile, '--minutes', '2'], {
      // The fake CEO's script proposes v0.3's job titles; the report it reads is what this spec checks, not the shape.
      WORKLINGS_SHAPE: 'classic',
      WORKLINGS_CLAUDE: FAKE_DESK,
      FAKE_DESK_SCRIPT: scriptFile,
      FAKE_DESK_LOG: join(dir, 'desk.jsonl'),
      FAKE_DESK_SESSIONS: join(dir, 'sessions'),
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: '1',
    });
    expect(result.stderr).toContain('FAKE desk');
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);

    const report = JSON.parse(readFileSync(jsonFile, 'utf8')) as Report;
    expect(report.failure).toBeNull();
    expect(report.dryRun).toBe(true);
    // The org as the CEO ended with it: medium, three makers under the CEO.
    expect(report.org?.size).toBe('medium');
    expect(report.org?.people.map((p) => p.id)).toEqual(['ceo', 'frontend-engineer', 'backend-engineer', 'ui-designer']);
    // The plan as the CEO ended with it, with its checks and its one verification task by the CEO.
    expect(report.plan?.version).toBe(1);
    expect(report.plan?.tasks.map((t) => [t.id, t.check, t.kind, t.owner])).toEqual([
      ['p-1', 'npm test', null, 'frontend-engineer'],
      ['p-2', 'npm run typecheck && npm test', null, 'backend-engineer'],
      ['p-3', null, 'verification', 'ceo'],
    ]);
    // Each turned-down answer, once, with the sentences that came back.
    expect(report.refusals.org).toHaveLength(1);
    expect(report.refusals.org[0]?.errors.join('\n')).toContain('a small company is the CEO plus exactly one maker, and this has 3 makers ("frontend-engineer", "backend-engineer" and "ui-designer")');
    expect(report.refusals.plan).toHaveLength(1);
    const plan = report.refusals.plan[0]?.errors.join('\n') ?? '';
    expect(plan).toContain('“Build the app” (p-1) has no check');
    expect(plan).toContain('“Write tests for the app” (p-2) is only tests of another task\'s work; fold it into');
    // The final review is the office's: the CEO is never refused for one, and the one it wrote is a note, not a refusal.
    expect(plan).not.toContain('no final verification');
    expect(report.refusals.plan[0]?.count).toBe(2);
    expect(report.notes.plan.flatMap((n) => n.notes).join(' ')).toContain('The final review is added by the office');
    // It says so on screen, and that nothing was approved or built.
    expect(result.stdout).toContain('REFUSED by the proposal check (org): 1 time');
    expect(result.stdout).toContain('REFUSED by the plan check and linter (plan): 1 time');
    expect(result.stdout).toContain('Plan approved: no. Nothing was built.');
    // Its temp project and home are gone.
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('plan-only-') && !before.includes(n))).toEqual([]);
  });

  it('refuses a missing or double prompt, and an unknown preset, before it starts anything', async () => {
    for (const args of [[], ['--prompt', 'x', 'prompt.md'], ['--prompt', 'x', '--preset', 'huge'], ['--prompt', 'x', '--model', 'gpt']]) {
      const result = await run(args, {});
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Usage: node scripts/plan-only.mjs');
    }
  });
});
