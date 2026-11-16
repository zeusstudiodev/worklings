// The benchmark's dry run, at zero cost: every arm and step of the harness with Claude Code faked, so the pipeline can
// be checked end to end before anything real is started.
//
//   node scripts/bench/dry-run.mjs [task...]      (default: all three tasks)
//
// Arm A runs scripts/bench/fake-solo.mjs (a weak first attempt, written to the folder). Arm B runs a real hub with
// test/fake-desk.mjs as every desk, playing a script that asks scoping questions (which the harness answers with the
// CEO's picks), proposes an org, proposes a plan, reports each task done and accepts it, so the company reaches "done"
// with no files written (a fake desk writes none). Both are scored and
// reported; the scores are low on purpose. Output goes to a temp folder that is deleted unless BENCH_DRY_KEEP=1.
// WORKLINGS_CLAUDE is always set here, so no real Claude Code starts.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, removeTree, TASKS } from './lib.mjs';

const tasks = process.argv.length > 2 ? process.argv.slice(2) : TASKS;
const root = mkdtempSync(join(tmpdir(), 'bench-dry-'));
const here = (file) => join(REPO, 'scripts', 'bench', file);

const member = (id, name, title, level, room, reportsTo, model, owns, library) => ({ id, name, title, level, room, reportsTo, model, owns, library });
const PROPOSAL = {
  company: 'Bench Co',
  goal: 'Build what the stakeholder asked for.',
  size: 'medium',
  sizing: 'Three makers: a designer, a frontend and a backend engineer, flat under me, since the work is one small app.',
  theme: 'office',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'design', title: 'Design', style: 'design' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  // The CEO's proposals are flat below five makers: the CEO and three people who do the work, all reporting to it.
  people: [
    member('ceo', 'Noor', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the line to the stakeholder', 'ceo'),
    member('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'ceo', 'sonnet', 'The look and the flows', 'ui-designer'),
    member('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'ceo', 'sonnet', 'The screens', 'frontend-engineer'),
    member('backend-engineer', 'Ivo', 'Backend engineer', 'worker', 'engineering', 'ceo', 'sonnet', 'The data and the logic', 'backend-engineer'),
  ],
  questions: [],
};
const PLAN = {
  goal: 'Build what was asked.',
  milestones: [
    { id: 'ms-1', title: 'Core', doneWhen: 'The core works.' },
    { id: 'ms-2', title: 'Checks', doneWhen: 'It is reviewed.' },
  ],
  tasks: [
    { id: 'p-1', title: 'Build the logic', owner: 'backend-engineer', files: ['src/'], milestone: 'ms-1', after: [], brief: 'The logic.', doneWhen: 'It works.', check: 'npm test' },
    { id: 'p-2', title: 'Build the screens', owner: 'frontend-engineer', files: ['web/'], milestone: 'ms-1', after: ['p-1'], brief: 'The screens.', doneWhen: 'They render.', check: 'npm run typecheck' },
    { id: 'p-3', title: 'Design the look', owner: 'ui-designer', files: ['docs/design/'], milestone: 'ms-1', after: [], brief: 'The look.', doneWhen: 'It is written down.', check: 'node --version' },
    { id: 'p-4', title: 'Review the whole result', owner: 'ceo', files: [], milestone: 'ms-2', after: ['p-1', 'p-2', 'p-3'], brief: 'Review the whole diff against the stakeholder_words.', doneWhen: 'Each requirement from stakeholder_words has a result.', kind: 'verification' },
  ],
};
const SCOPING = [
  { text: 'Who is it for?', options: ['Just me', 'Anyone'], recommended: 1, why: 'Most tools like this are for other people too.' },
  { text: 'How far should the first version go?', options: ['A quick prototype', 'A solid first release'], recommended: 1, why: 'Solid enough to use, small enough to finish.' },
];
const scenarios = {
  scope: [{ org: 'ask_scoping', arguments: { questions: SCOPING } }, { say: 'I asked two questions before drafting.' }],
  found: [{ org: 'propose_org', arguments: PROPOSAL }, { say: 'I proposed an org.' }],
  plan: [{ org: 'propose_plan', arguments: { ...PLAN, note: 'First plan.' } }, { say: 'I proposed a plan.' }],
};
const byText = [
  { includes: 'First propose the plan with propose_plan', scenario: 'plan' },
  { includes: 'Answers to your scoping questions', scenario: 'found' },
  { includes: 'your first move is ask_scoping', scenario: 'scope' },
];
for (let n = 1; n <= 8; n += 1) {
  scenarios[`report-${n}`] = [{ tool: 'Bash', input: { command: 'node --version', description: 'Check Node' }, ms: 300 }, { org: 'report', arguments: { outcome: 'done', summary: `Task t-${n} is done.`, task: `t-${n}` } }, { say: 'Reported.' }];
  scenarios[`accept-${n}`] = [{ org: 'review', arguments: { task: `t-${n}`, verdict: 'accept', note: 'Looks good.' } }, { say: 'Accepted.' }];
  byText.push({ includes: `New task t-${n}`, scenario: `report-${n}` }, { includes: `Report on task t-${n},`, scenario: `accept-${n}` });
}
const scriptFile = join(root, 'desk-script.json');
writeFileSync(scriptFile, JSON.stringify({ default: [{ say: 'On it.' }], byText, scenarios }));

const env = {
  ...process.env,
  BENCH_MINUTES: process.env.BENCH_MINUTES || '4',
  BENCH_QUIET_S: process.env.BENCH_QUIET_S || '8',
  BENCH_DESKS: '3',
  BENCH_ROOT: process.env.BENCH_ROOT,
  FAKE_DESK_SCRIPT: scriptFile,
  FAKE_DESK_SESSIONS: join(root, 'desk-sessions'),
  FAKE_DESK_LOG: join(root, 'desk.jsonl'),
};
delete env.CLAUDECODE;
const node = (args, extra) => spawnSync(process.execPath, args, { cwd: REPO, env: { ...env, ...extra }, stdio: 'inherit' });

const outs = [];
for (const task of tasks) {
  for (const arm of ['a', 'b']) {
    const out = join(root, `${task}-${arm}`);
    outs.push(out);
    console.log(`\n=== ${task} arm ${arm.toUpperCase()} (dry) ===`);
    node([here(`run-${arm}.mjs`), task, out], { WORKLINGS_CLAUDE: arm === 'a' ? here('fake-solo.mjs') : join(REPO, 'test', 'fake-desk.mjs') });
    node([here('score.mjs'), task, out]);
  }
}
console.log('\n=== report ===');
node([here('report.mjs'), ...outs]);
if (process.env.BENCH_DRY_KEEP === '1') console.log(`\nkept: ${root}`);
else removeTree(root);
