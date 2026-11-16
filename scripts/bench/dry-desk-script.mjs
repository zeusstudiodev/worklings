// The scripted company test/fake-desk.mjs plays in a dry run (the same script dry-run.mjs writes): scoping questions,
// an org, a plan, then each task reported done and accepted, so the company reaches "done" with no files written.
export function deskScript() {
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
  // v0.4: the CLI founds harness companies (WORKLINGS_SHAPE=classic for v0.3's), whose Lead proposes the seats and plans
  // milestones; the office writes the Tester's and the Builder's tasks and the final review.
  const HARNESS_PROPOSAL = {
    ...PROPOSAL,
    size: 'small',
    sizing: 'Balanced: one small tool, so one Builder.',
    rooms: [PROPOSAL.rooms[0], PROPOSAL.rooms[2], { id: 'quality', title: 'Quality', style: 'quality' }],
    people: [
      PROPOSAL.people[0],
      member('builder', 'Sam', 'Builder', 'worker', 'engineering', 'ceo', 'sonnet', 'The whole codebase', 'builder'),
      member('tester', 'Tal', 'Tester', 'worker', 'quality', 'ceo', 'sonnet', 'The acceptance tests', 'tester'),
      member('reviewer', 'Rae', 'Reviewer', 'worker', 'quality', 'ceo', 'sonnet', 'The final review', 'reviewer'),
    ],
  };
  const HARNESS_PLAN = {
    goal: 'Build what was asked.',
    milestones: PLAN.milestones,
    tasks: [],
    checklist: [{ id: 'k-1', text: 'It does what was asked', quote: null, covers: ['ms-1'] }],
  };
  // v0.5: the solo shape (the CLI's default) has no Tester; its Lead plans one milestone for the whole request.
  const shape = process.env.WORKLINGS_SHAPE === 'classic' || process.env.WORKLINGS_SHAPE === 'harness' ? process.env.WORKLINGS_SHAPE : 'solo';
  const harness = shape !== 'classic';
  const SOLO_PROPOSAL = { ...HARNESS_PROPOSAL, people: HARNESS_PROPOSAL.people.filter((p) => p.id !== 'tester') };
  const SOLO_PLAN = { ...HARNESS_PLAN, milestones: [{ id: 'ms-1', title: 'Everything asked for', doneWhen: 'It does what was asked.' }] };
  const SCOPING = [
    { text: 'Who is it for?', options: ['Just me', 'Anyone'], recommended: 1, why: 'Most tools like this are for other people too.' },
    { text: 'How far should the first version go?', options: ['A quick prototype', 'A solid first release'], recommended: 1, why: 'Solid enough to use, small enough to finish.' },
  ];
  const scenarios = {
    scope: [{ org: 'ask_scoping', arguments: { questions: SCOPING } }, { say: 'I asked two questions before drafting.' }],
    found: [{ org: 'propose_org', arguments: shape === 'solo' ? SOLO_PROPOSAL : harness ? HARNESS_PROPOSAL : PROPOSAL }, { say: 'I proposed an org.' }],
    plan: [{ org: 'propose_plan', arguments: { ...(shape === 'solo' ? SOLO_PLAN : harness ? HARNESS_PLAN : PLAN), note: 'First plan.' } }, { say: 'I proposed a plan.' }],
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
  return { default: [{ say: 'On it.' }], byText, scenarios };
}
