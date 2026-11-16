// The org tools themselves, called the way a desk calls them (tools/call on MCP 2026-07-28) against a fake company:
// every tool for someone who may use it and refused to someone who may not, the arguments checked with a sentence that
// names the field, refusals and failures, and share_screenshot's rules for files.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS, type OfficeChange, ORG_TOOLS, personById, STAKEHOLDER, toolsFor } from '../src/core/company.ts';
import { PROPOSAL_LIMITS } from '../src/core/org.ts';
import { LEVELS, ROLE_ID } from '../src/core/studio.ts';
import { tooLong } from '../src/core/too-long.ts';
import { tempDir, writeTree } from './library-kit.ts';
import { closeServers, methods, type Office, office, ok, refused, tokenOf } from './orgtools-kit.ts';

afterEach(closeServers);

describe('who may use which tool', () => {
  it("lists each person the tools of their level, and the office manager's change_office", async () => {
    const o = await office();
    for (const id of ['ui-designer', 'frontend-lead', 'head-of-design', 'ceo', 'office-manager']) {
      const me = personById(o.company.staff, id);
      expect(await o.list(id)).toEqual(me ? toolsFor(me) : []);
    }
    expect(await o.list('ceo')).toEqual([...ORG_TOOLS.everyone, ...ORG_TOOLS.managers, ...ORG_TOOLS.ceo]);
    expect(await o.list('office-manager')).toEqual([...ORG_TOOLS.everyone, 'change_office']);
  });

  it("refuses the managers' tools to a worker without asking the company", async () => {
    const o = await office();
    for (const tool of ORG_TOOLS.managers) {
      expect(await o.call('ui-designer', tool, {})).toEqual(refused(`Only heads, team leads and the CEO can use ${tool}. Ask your manager instead.`));
    }
    expect(o.company.calls).toEqual([]);
  });

  it("refuses the CEO's tools to everyone else, pointing them up the org", async () => {
    const o = await office();
    for (const tool of ORG_TOOLS.ceo.filter((t) => t !== 'change_office')) {
      expect(await o.call('head-of-design', tool, {})).toEqual(refused(`Only the CEO can use ${tool}. Ask the CEO.`));
      expect(await o.call('frontend-lead', tool, {})).toEqual(refused(`Only the CEO can use ${tool}. Ask your manager to take it to the CEO.`));
    }
    expect(o.company.calls).toEqual([]);
  });

  it('lets the CEO and the office manager change the office, and nobody else', async () => {
    const o = await office();
    const change = { change: 'theme', theme: 'arcade' };
    expect(await o.call('office-manager', 'change_office', change)).toEqual(ok('Changed the office.'));
    expect(await o.call('ceo', 'change_office', change)).toEqual(ok('Changed the office.'));
    expect(await o.call('head-of-design', 'change_office', change)).toEqual(refused('Only the CEO and the office manager can use change_office. Ask the CEO.'));
    expect(o.company.calls.map((c) => c.by)).toEqual(['office-manager', 'ceo']);
  });

  it('closes the tools to someone who has left the org', async () => {
    const o = await office();
    expect(await o.list('gone')).toEqual([]);
    expect(await o.call('gone', 'post_status', { text: 'Still here?' })).toEqual(refused("You aren't in this company's org any more, so its tools are closed to you."));
  });
});

describe("everyone's tools", () => {
  it('post_status posts one line for the Now board', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'post_status', { text: '  Building the\nstreak card.  ', task: 't-1' })).toEqual(ok('Posted on the Now board.'));
    expect(o.company.calls).toEqual([{ method: 'postStatus', by: 'ui-designer', input: { text: 'Building the streak card.', taskId: 't-1' } }]);
  });

  it('report goes to the manager and says where the task stands', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'report', { outcome: 'done', summary: 'The card shows the streak.', task: 't-1' })).toEqual(
      ok('Reported to Ada, head of design; "Build the streak card" (t-1) is waiting for review.'),
    );
    expect(await o.call('ceo', 'report', { outcome: 'progress', summary: 'Half the org is at work.' })).toEqual(ok('Reported to the stakeholder.'));
    expect(o.company.calls[0]).toEqual({ method: 'report', by: 'ui-designer', input: { taskId: 't-1', outcome: 'done', text: 'The card shows the streak.' } });
  });

  it('message reaches a person, the manager or the stakeholder, and the org rules decide', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'message', { to: 'ux-designer', text: 'Can I see the flow?' })).toEqual(ok('Sent to Lea, UX designer. It reaches them at their next step; a reply comes to you as a message.'));
    expect((await o.call('ui-designer', 'message', { to: 'manager', text: 'Done soon.' })).text).toMatch(/^Sent to Ada, head of design\./);
    expect((await o.call('ceo', 'message', { to: '@stakeholder', text: 'The org is ready.' })).text).toMatch(/^Sent to the stakeholder\./);
    expect((await o.call('ceo', 'message', { to: 'manager', text: 'And started.' })).text).toMatch(/^Sent to the stakeholder\./);
    expect(await o.call('ui-designer', 'message', { to: 'frontend-engineer', text: 'Hi Sam.' })).toEqual(refused('You can reach that team only through your manager.'));
    expect(await o.call('ui-designer', 'message', { to: 'nobody-here', text: 'Hello?' })).toEqual(refused('Nobody in the org has the id "nobody-here"; org lists everyone\'s id.'));
    expect(o.company.calls.map((c) => c.input)).toEqual([
      { to: 'ux-designer', text: 'Can I see the flow?' },
      { to: 'head-of-design', text: 'Done soon.' },
      { to: STAKEHOLDER, text: 'The org is ready.' },
      { to: STAKEHOLDER, text: 'And started.' },
      { to: 'frontend-engineer', text: 'Hi Sam.' },
    ]);
  });

  it('ask answers at once, and the answer comes later as a message', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'ask', { to: 'manager', question: 'Dark or light header?' })).toEqual(ok('Asked Ada, head of design. The answer comes to you as a message.'));
    expect(await o.call('ui-designer', 'ask', { to: 'stakeholder', question: 'Which payment do we take?', options: ['TWINT', 'Card', 'Both'], recommended: 2, task: 't-1' })).toEqual(
      ok('Asked the stakeholder, with a copy to your manager. The answer comes to you as a message. If nobody answers in about ten minutes, it counts as a no and you carry on with your fallback.'),
    );
    expect(o.company.calls[1]).toEqual({ method: 'ask', by: 'ui-designer', input: { text: 'Which payment do we take?', options: ['TWINT', 'Card', 'Both'], recommended: 2, to: 'stakeholder', taskId: 't-1' } });
  });

  it('ask needs options for the stakeholder, a pick among them, and no choice twice', async () => {
    const o = await office();
    expect((await o.call('ui-designer', 'ask', { to: 'stakeholder', question: 'Which payment?' })).text).toMatch(/^A question for the stakeholder needs options: 2 to 4 choices/);
    expect(await o.call('ui-designer', 'ask', { to: 'stakeholder', question: 'Which payment?', options: ['TWINT', 'Card'], recommended: 4 })).toEqual(
      refused('recommended must be a whole number from 0 to 3, not the number 4.'),
    );
    expect(await o.call('ui-designer', 'ask', { to: 'stakeholder', question: 'Which payment?', options: ['TWINT', 'Card'], recommended: 2 })).toEqual(refused('recommended is 2, but the options go from 0 to 1.'));
    expect(await o.call('ui-designer', 'ask', { to: 'stakeholder', question: 'Which payment?', options: ['Card', 'card'] })).toEqual(refused('options has "card" twice; give each choice once.'));
    expect(await o.call('ui-designer', 'ask', { to: 'stakeholder', question: 'Which?', options: ['One'] })).toEqual(refused('options needs at least 2 entries; it has 1.'));
    expect(o.company.calls).toEqual([]);
  });

  it('org gives the chart in words: who reports to whom, rooms and who is on what', async () => {
    const o = await office();
    const { text, isError } = await o.call('frontend-engineer', 'org');
    expect(isError).toBe(false);
    expect(text.split('\n').slice(0, 4)).toEqual([
      'The org of Pickup Café: 9 people. You are Sam, frontend engineer (frontend-engineer).',
      'Goal: Take pickup orders online by spring.',
      '',
      'Noor, CEO (ceo), direction, reports to the stakeholder (Robin): no task.',
    ]);
    expect(text).toContain('    Kai, UI designer (ui-designer), design, reports to Ada: on "Build the streak card" (t-1), in progress, working now. Latest: "Wiring the card to the API."');
    expect(text).toContain('      Sam, frontend engineer (frontend-engineer), engineering, reports to Ola: no task.');
    expect(text.split('\n')).toContain('    The QA engineer (qa-engineer), engineering, reports to Ben: no task.');
    expect(text).toContain('Rooms: direction (Noor and Tia); design (Ada, Kai and Lea); engineering (Ben, Ola, Sam and the QA engineer).');
    expect(text).toContain('Also in the office: meeting room (meeting).');
  });

  it('tasks lists open work, filters it and shows one task in full', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'tasks')).toEqual(
      ok(
        [
          '2 tasks (1 done or dropped not shown; give status to see them):',
          '- t-1 "Build the streak card": Kai (ui-designer), in progress; files web/src/streak/.',
          '- t-2 "Map the pickup flow": Lea (ux-designer), queued.',
        ].join('\n'),
      ),
    );
    expect((await o.call('ui-designer', 'tasks', { owner: 'me' })).text).toBe('1 task:\n- t-1 "Build the streak card": Kai (ui-designer), in progress; files web/src/streak/.');
    expect((await o.call('ui-designer', 'tasks', { status: 'done' })).text).toBe('1 task:\n- t-3 "Set up the build": Sam (frontend-engineer), done.');
    expect((await o.call('ui-designer', 'tasks', { owner: 'qa-engineer' })).text).toBe('No open tasks.');
    const full = await o.call('ui-designer', 'tasks', { task: 't-3' });
    expect(full.text.split('\n')).toEqual([
      't-3 "Set up the build"',
      'Owner: Sam, frontend engineer (frontend-engineer). Asked by: Ola, frontend lead. Status: done.',
      'Files: none named.',
      'Done when: It works on a phone.',
      'Brief: Brief for Set up the build.',
      'Outcome: The build runs in CI.',
    ]);
    expect(await o.call('ui-designer', 'tasks', { task: 't-99' })).toEqual(refused('There is no task t-99; tasks lists them.'));
    expect(await o.call('ui-designer', 'tasks', { owner: 'nobody-here' })).toEqual(refused('Nobody in the org has the id "nobody-here"; org lists everyone\'s id.'));
  });
});

describe("managers' tools", () => {
  it('assign gives a task to one of their own people, with the files named the same way every time', async () => {
    const o = await office();
    const answer = await o.call('head-of-design', 'assign', {
      to: 'ui-designer',
      title: 'Make the palette darker',
      brief: 'The stakeholder wants a darker palette.',
      files: ['./web/src//theme.css', 'web\\src\\tokens\\', 'web/src/**/*.css', 'web/src/theme.css'],
      doneWhen: 'Every screen uses the darker palette.',
      milestone: 'm-1',
    });
    expect(answer).toEqual(ok('Kai has the task "Make the palette darker" (t-4).'));
    expect(o.company.calls).toEqual([
      {
        method: 'assign',
        by: 'head-of-design',
        input: {
          to: 'ui-designer',
          title: 'Make the palette darker',
          brief: 'The stakeholder wants a darker palette.',
          files: ['web/src/theme.css', 'web/src/tokens/', 'web/src/**/*.css'],
          doneWhen: 'Every screen uses the darker palette.',
          parent: null,
          milestone: 'm-1',
          worktree: false,
        },
      },
    ]);
    // Claude Code's file tools use absolute paths: one inside the project is kept relative to it.
    expect((await o.call('head-of-design', 'assign', { to: 'ux-designer', title: 'Map the menu', brief: 'B', doneWhen: 'D', files: [join(o.root, 'web', 'src', 'menu.tsx')] })).isError).toBe(false);
    expect(o.company.calls.at(-1)?.input).toMatchObject({ files: ['web/src/menu.tsx'] });
    const long = await o.call('head-of-engineering', 'assign', { to: 'qa-engineer', title: 'Test the checkout', brief: 'End to end.', files: [], doneWhen: 'All green.', worktree: true });
    expect(long).toEqual(ok('The QA engineer has the task "Test the checkout" (t-6). It runs in its own worktree on the branch worklings/t-6, which you merge when it is done.'));
  });

  it("assign refuses files outside the project and the office's own state, and someone else's people", async () => {
    const o = await office();
    const base = { to: 'ui-designer', title: 'T', brief: 'B', doneWhen: 'D' };
    expect(await o.call('head-of-design', 'assign', { ...base, files: ['../other-project/a.ts'] })).toEqual(refused('files[0] must stay inside the project: leave out the "..".'));
    expect(await o.call('head-of-design', 'assign', { ...base, files: ['src/a.ts', 'C:\\Windows\\a.ts'] })).toEqual(refused('files[1] is outside the project; name files relative to it, like "src/app.ts".'));
    expect(await o.call('head-of-design', 'assign', { ...base, files: ['/etc/passwd'] })).toEqual(refused('files[0] is outside the project; name files relative to it, like "src/app.ts".'));
    expect(await o.call('head-of-design', 'assign', { ...base, files: ['.GIT/config'] })).toEqual(refused('files[0] is in .GIT/, which no task may own.'));
    expect(await o.call('head-of-design', 'assign', { ...base, files: ['.worklings/events.jsonl'] })).toEqual(refused('files[0] is in .worklings/, which no task may own.'));
    expect(await o.call('head-of-design', 'assign', { ...base, files: ['src/a|b.ts'] })).toEqual(refused('files[0] has a character no path in the project can hold.'));
    expect(o.company.calls).toEqual([]);
    expect(await o.call('head-of-design', 'assign', { ...base, to: 'frontend-engineer', files: [] })).toEqual(refused("frontend-engineer isn't one of your people; assign work to the people below you."));
  });

  it('assign refuses a file reached through a link in the project', async (ctx) => {
    const o = await office();
    const elsewhere = tempDir('worklings-orgtools-elsewhere-');
    mkdirSync(join(o.root, 'web'), { recursive: true });
    try {
      symlinkSync(elsewhere, join(o.root, 'web', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(String(error.code))) ctx.skip('this machine cannot make a folder link');
      throw error;
    }
    const answer = await o.call('head-of-design', 'assign', { to: 'ui-designer', title: 'T', brief: 'B', doneWhen: 'D', files: ['web/linked/theme.css'] });
    expect(answer).toEqual(refused("files[0]: web/linked is a symlink or junction; Worklings doesn't read or write through links."));
  });

  it('relay passes a message on, the last one received when none is named', async () => {
    const o = await office();
    expect(await o.call('head-of-design', 'relay', { to: ['ui-designer', 'ux-designer', 'ui-designer'], note: 'Darker for every screen, please.' })).toEqual(ok('Passed on to Kai, UI designer and Lea, UX designer.'));
    expect(o.company.calls[0]).toEqual({ method: 'relay', by: 'head-of-design', input: { message: 'm-2', to: ['ui-designer', 'ux-designer'], note: 'Darker for every screen, please.' } });
    expect(await o.call('head-of-engineering', 'relay', { to: ['qa-engineer'] })).toEqual(refused('You have received no message to pass on yet.'));
    expect(await o.call('ceo', 'relay', { message: 'm-1', to: ['head-of-design'] })).toEqual(ok('Passed on to Ada, head of design.'));
    expect(await o.call('ceo', 'relay', { to: [] })).toEqual(refused('to needs at least 1 entry; it has 0.'));
  });

  it('tells managers to name the message to relay by the id its turn gives', async () => {
    const o = await office();
    const relay = await o.listed('head-of-design', 'relay');
    expect(String(relay.description)).toContain('a turn that says "(message m-12)" is message m-12');
    expect(relay.inputSchema).toMatchObject({ properties: { message: { description: expect.stringContaining('"(message m-12)" is m-12') } } });
  });

  it('review accepts finished work, or returns it with a note', async () => {
    const o = await office();
    expect(await o.call('frontend-lead', 'review', { task: 't-3', verdict: 'accept' })).toEqual(ok('Accepted "Set up the build" (t-3); it is done.'));
    expect(await o.call('head-of-design', 'review', { task: 't-1', verdict: 'return' })).toEqual(refused('review needs a note to return a task: say what to change.'));
    expect(await o.call('head-of-design', 'review', { task: 't-1', verdict: 'return', note: 'The streak count is cut off on small phones.' })).toEqual(ok('Returned "Build the streak card" (t-1) to Kai, UI designer with your note.'));
    expect(o.company.calls.map((c) => c.input)).toEqual([
      { taskId: 't-3', verdict: 'accept', note: '' },
      { taskId: 't-1', verdict: 'return', note: 'The streak count is cut off on small phones.' },
    ]);
  });
});

describe("the CEO's tools", () => {
  it('library_catalogue lists the roles to hire', async () => {
    const o = await office();
    expect((await o.call('ceo', 'library_catalogue')).text.split('\n')).toEqual([
      '2 roles in the library (id: title, room, model, what it does):',
      '- copywriter: Copywriter, content, sonnet. Writes the words people read: pages, buttons, emails and errors, in the brand voice.',
      '- seo-specialist: SEO specialist, content, haiku. Gets the site found: search intent, structure, metadata and local listings.',
      'What the user has installed, which you can assign to people in propose_org (loads):',
      expect.stringMatching(/^- tools: built-in tools; leave it out for the default \(workers Read, Edit, Write, Bash, Glob, Grep; you and managers Read, Glob, Grep, Bash\)/),
      expect.stringMatching(/^- skills: true adds the Skill tool/),
      '- mcp: the user has no MCP servers installed, so there is nothing to assign.',
      'Everyone starts lean, with only the defaults, and gets nothing they are not assigned; assign by role, not by habit.',
    ]);
  });

  it('library_catalogue also lists the MCP servers the user has installed, by name and one line, and nothing that is secret', async () => {
    const dir = tempDir('worklings-ot-config-');
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://api.example.test/mcp?key=sk-SECRET', headers: { Authorization: 'Bearer sk-SECRET' } } } }));
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      const o = await office();
      const text = (await o.call('ceo', 'library_catalogue')).text;
      expect(text).toContain('- mcp: names of MCP servers');
      expect(text).toContain('  - github: A server you added yourself (github), runs over the web');
      expect(text).not.toMatch(/sk-SECRET|api\.example\.test|Authorization/);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });

  it("propose_org passes the proposal to the company and gives back its sentences when it doesn't check out", async () => {
    const o = await office();
    const person = { id: 'x', name: 'X', title: 'X', level: 'worker', room: 'design', reportsTo: 'ceo', model: 'sonnet', owns: 'x', unknownExtra: { kept: true } };
    const proposal = {
      company: 'Pickup Café', goal: 'Pickup orders online.', size: 'large', sizing: 'Nine people: a design side and an engineering side.', theme: 'cafe',
      rooms: [{ id: 'design', title: 'Design', style: 'design' }], people: Array.from({ length: 9 }, () => person), questions: [],
    };
    expect(await o.call('ceo', 'propose_org', proposal)).toEqual(ok('Proposed Pickup Café: 9 people in 0 rooms, with 1 question for the stakeholder. The stakeholder reviews it and starts the company; what they want changed comes to you as a message.'));
    // Passed through untouched: the company's check decides what the nested fields may hold.
    expect(o.company.calls[0]?.input).toEqual(proposal);
    expect(await o.call('ceo', 'propose_org', { ...proposal, people: [person] })).toEqual(refused('- An org has at least 2 people; this one has 1.\n- design needs a head.'));
    expect(await o.call('ceo', 'propose_org', { ...proposal, people: 'everyone' })).toEqual(refused('people must be a list, not "everyone".'));
    expect(await o.call('ceo', 'propose_org', { ...proposal, budget: 100 })).toEqual(refused('propose_org doesn\'t take budget; it takes company, goal, size, sizing, theme, rooms, people and questions.'));
    // Why this size is a field of its own, which the model is asked for.
    const { sizing: _sizing, ...unsized } = proposal;
    expect(await o.call('ceo', 'propose_org', unsized)).toEqual(refused(expect.stringMatching(/^propose_org needs sizing\. Why this size, in one sentence/)));
    // The size is the CEO's one judgment, and code holds the org to it, so it is required.
    const { size: _size, ...unjudged } = proposal;
    expect(await o.call('ceo', 'propose_org', unjudged)).toEqual(refused(expect.stringMatching(/^propose_org needs size\. How big the company is: "small"/)));
  });

  it('ask_scoping asks the stakeholder a few questions before the org, each with its pick and why', async () => {
    const o = await office();
    const questions = [
      { text: 'Who is it for?', options: ['Just me', 'Anyone'], recommended: 1, why: 'Most tools like this are for other people too.' },
      { text: 'How far should it go?', options: ['A prototype', 'A first release'], recommended: 0, why: 'A prototype answers the big question soonest.' },
    ];
    expect(await o.call('ceo', 'ask_scoping', { questions })).toEqual(
      ok('Asked the stakeholder 2 questions. The answers come to you together in one message once they are all in, so end your turn now; then draft the org from them with propose_org.'),
    );
    expect(o.company.calls.at(-1)).toEqual({ method: 'askScoping', by: 'ceo', input: questions });
    // The tool checks the shape: a pick that is no option, a missing why, a sixth question.
    expect(await o.call('ceo', 'ask_scoping', { questions: [{ ...questions[0], recommended: 2 }] })).toEqual(refused('recommended is 2, but the options go from 0 to 1.'));
    expect(await o.call('ceo', 'ask_scoping', { questions: [{ text: 'Who?', options: ['Me', 'Anyone'], recommended: 0 }] })).toEqual(refused(expect.stringMatching(/why/)));
    expect(await o.call('ceo', 'ask_scoping', { questions: Array.from({ length: 6 }, (_, i) => ({ ...questions[0], text: `Question ${i}?` })) })).toEqual(refused(expect.stringMatching(/questions/)));
    expect(await o.call('ceo', 'ask_scoping', { questions: [{ ...questions[0], options: ['Me', 'me'] }] })).toEqual(refused('options has "me" twice; give each choice once.'));
    // Only the CEO asks them.
    expect((await o.call('ux-designer', 'ask_scoping', { questions })).isError).toBe(true);
  });

  it('ask_stakeholder puts a decision in the inbox and answers at once', async () => {
    const o = await office();
    expect(await o.call('ceo', 'ask_stakeholder', { question: 'Launch in German first?', options: ['German first', 'Both at once'], recommended: 0 })).toEqual(
      ok('Asked the stakeholder. The answer comes to you as a message. If nobody answers in about ten minutes, it counts as a no and you carry on with your fallback.'),
    );
    expect(o.company.calls).toEqual([{ method: 'askStakeholder', by: 'ceo', input: { text: 'Launch in German first?', options: ['German first', 'Both at once'], recommended: 0, taskId: null } }]);
    expect(await o.call('ceo', 'ask_stakeholder', { question: 'Launch in German first?' })).toEqual(refused('ask_stakeholder needs options. 2 to 4 choices.'));
  });

  it('set_goal sets the goal with its milestones and names their ids', async () => {
    const o = await office();
    const milestones = [
      { title: 'Menu online', doneWhen: 'The menu shows on a phone.' },
      { title: 'Pickup orders', doneWhen: 'An order reaches the kitchen.' },
    ];
    expect(await o.call('ceo', 'set_goal', { goal: 'Take pickup orders online by spring.', milestones })).toEqual(ok('Set the goal, with 2 milestones: m-1 "Menu online", m-2 "Pickup orders".'));
    expect(await o.call('ceo', 'set_goal', { goal: 'Just the goal.' })).toEqual(ok('Set the goal.'));
    expect(await o.call('ceo', 'set_goal', { goal: 'G', milestones: [{ title: 'Menu online' }] })).toEqual(refused('milestones[0] needs doneWhen. How you will know it is reached.'));
  });

  it("publish_dashboard publishes widgets, and a malformed dashboard comes back with checkDashboard's sentence", async () => {
    const o = await office();
    const dashboard = { title: 'Launch', widgets: [{ kind: 'progress', title: 'Menu items', value: 12, max: 40 }] };
    expect(await o.call('ceo', 'publish_dashboard', dashboard)).toEqual(ok('Published "Launch" (d-1); it shows under Dashboards.'));
    expect(o.company.calls[0]?.input).toEqual(dashboard);
    expect(await o.call('ceo', 'publish_dashboard', { title: 'Launch', widgets: [{ kind: 'pie', title: 'Share' }] })).toEqual(
      refused('Widget 1 has kind "pie"; the office draws stat, progress, bars, line, list, table.'),
    );
    expect(await o.call('ceo', 'publish_dashboard', { title: 'Launch', widgets: 'all of them' })).toEqual(refused('widgets must be a list, not "all of them".'));
  });

  it('remove_dashboard takes a published dashboard down for the CEO, and org lists what is published', async () => {
    const o = await office();
    await o.call('ceo', 'publish_dashboard', { title: 'Launch', widgets: [{ kind: 'stat', title: 'Orders today', value: 14 }] });
    await o.call('ceo', 'publish_dashboard', { title: 'Menu', widgets: [{ kind: 'list', title: 'Specials', items: ['Cardamom bun'] }] });
    expect((await o.call('ceo', 'org')).text).toContain('Published dashboards: "Launch" (d-1) and "Menu" (d-2).');
    expect(await o.call('ceo', 'remove_dashboard', { dashboard: 'd-1' })).toEqual(ok('Took down "Launch" (d-1); it no longer shows under Dashboards.'));
    expect(o.company.calls.filter((c) => c.method === 'removeDashboard')).toEqual([{ method: 'removeDashboard', by: 'ceo', input: 'd-1' }]);
    expect((await o.call('ceo', 'org')).text).toContain('Published dashboards: "Menu" (d-2).');
    // The company's refusal for one that isn't published, and a sentence naming the field for an id that can't be one.
    expect(await o.call('ceo', 'remove_dashboard', { dashboard: 'd-1' })).toEqual(refused('There is no published dashboard d-1.'));
    expect(await o.call('ceo', 'remove_dashboard', {})).toEqual(refused('remove_dashboard needs dashboard. The id of the published dashboard, like "d-3".'));
    expect(await o.call('ceo', 'remove_dashboard', { dashboard: '../d-2' })).toEqual(refused('dashboard must be an id like "d-3", not "../d-2".'));
  });

  it('refuses remove_dashboard to everyone but the CEO, without asking the company', async () => {
    const o = await office();
    await o.call('ceo', 'publish_dashboard', { title: 'Launch', widgets: [{ kind: 'stat', title: 'Orders today', value: 14 }] });
    const before = o.company.calls.length;
    expect(await o.call('head-of-design', 'remove_dashboard', { dashboard: 'd-1' })).toEqual(refused('Only the CEO can use remove_dashboard. Ask the CEO.'));
    expect(await o.call('office-manager', 'remove_dashboard', { dashboard: 'd-1' })).toEqual(refused('Only the CEO can use remove_dashboard. Ask the CEO.'));
    expect(await o.call('frontend-engineer', 'remove_dashboard', { dashboard: 'd-1' })).toEqual(refused('Only the CEO can use remove_dashboard. Ask your manager to take it to the CEO.'));
    expect(o.company.calls).toHaveLength(before);
    expect(o.company.dashboards.map((d) => d.id)).toEqual(['d-1']);
  });

  it('hire, fire, move and rehire go to the company and answer with its sentence', async () => {
    const o = await office();
    expect(await o.call('ceo', 'hire', { role: 'copywriter', room: 'design', reportsTo: 'head-of-design', name: 'Lena', title: 'German copywriter' })).toEqual(ok('Hired Lena, German copywriter.'));
    expect(await o.call('ceo', 'fire', { role: 'qa-engineer' })).toEqual(ok('Fired the qa-engineer. Rehire brings them back.'));
    expect(await o.call('ceo', 'move', { role: 'ux-designer', room: 'engineering' })).toEqual(ok('Moved the ux-designer to engineering.'));
    expect(await o.call('ceo', 'rehire', { role: 'qa-engineer' })).toEqual(ok('Rehired the qa-engineer.'));
    expect(o.company.calls.map((c) => [c.method, c.input])).toEqual([
      ['hire', { role: 'copywriter', room: 'design', reportsTo: 'head-of-design', name: 'Lena', title: 'German copywriter' }],
      ['fire', 'qa-engineer'],
      ['move', { role: 'ux-designer', room: 'engineering', reportsTo: null }],
      ['rehire', 'qa-engineer'],
    ]);
    o.company.reshapeAnswer = { ok: false, message: 'There is no role copywritr in the library.', changed: [] };
    expect(await o.call('ceo', 'hire', { role: 'copywritr', room: 'design', reportsTo: 'head-of-design' })).toEqual(refused('There is no role copywritr in the library.'));
    expect(await o.call('ceo', 'hire', { role: 'copywriter', room: 'design', reportsTo: 'head-of-design', name: 'Lena 2' })).toEqual(refused('name must be a first name like "Lena", not "Lena 2".'));
  });

  it('hire takes a level, an id for a second person in a library role, and a role written for a niche area', async () => {
    const o = await office();
    expect(await o.call('ceo', 'hire', { role: 'copywriter', room: 'design', reportsTo: 'ceo', name: 'Lena', title: 'Head of content', level: 'head' })).toEqual(ok('Hired Lena, Head of content.'));
    expect(await o.call('ceo', 'hire', { role: 'frontend-engineer', room: 'engineering', reportsTo: 'frontend-lead', name: 'Ines', id: 'frontend-engineer-2' })).toEqual(ok('Hired Ines, frontend-engineer.'));
    const description = 'Builds TWINT payments: the merchant API, QR codes at the counter, refunds and the bank reconciliation.';
    const body = '# TWINT payments engineer\n\nOwns the TWINT integration.';
    const written = { description: `  ${description}\n`, body, tags: [' payments ', 'switzerland'] };
    expect((await o.call('ceo', 'hire', { role: 'twint-payments-engineer', room: 'engineering', reportsTo: 'head-of-engineering', name: 'Nico', written })).isError).toBe(false);
    expect(o.company.calls.map((c) => c.input)).toEqual([
      { role: 'copywriter', room: 'design', reportsTo: 'ceo', name: 'Lena', title: 'Head of content', level: 'head' },
      { role: 'frontend-engineer', room: 'engineering', reportsTo: 'frontend-lead', name: 'Ines', title: null, id: 'frontend-engineer-2' },
      { role: 'twint-payments-engineer', room: 'engineering', reportsTo: 'head-of-engineering', name: 'Nico', title: null, written: { description, body, tags: ['payments', 'switzerland'] } },
    ]);
  });

  it('lists the hire fields with the limits of a written role', async () => {
    const o = await office();
    const hire = await o.listed('ceo', 'hire');
    expect(String(hire.description)).toMatch(/A second person in a library role .* needs id.*For a niche area the library has no role for, write the role instead/);
    expect(hire.inputSchema).toMatchObject({
      properties: {
        level: { enum: [...LEVELS] },
        id: { pattern: ROLE_ID.source },
        written: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'body'],
          properties: {
            description: { minLength: PROPOSAL_LIMITS.description.min, maxLength: PROPOSAL_LIMITS.description.max },
            body: { maxLength: PROPOSAL_LIMITS.body },
            tags: { maxItems: PROPOSAL_LIMITS.tags, items: { maxLength: PROPOSAL_LIMITS.tag } },
          },
        },
      },
    });
  });

  it('hire names what is wrong with a level, an id or a written role', async () => {
    const o = await office();
    const base = { role: 'twint-payments-engineer', room: 'engineering', reportsTo: 'head-of-engineering' };
    const role = { description: 'x'.repeat(80), body: 'Owns TWINT.' };
    const cases: [unknown, string][] = [
      [{ ...base, level: 'boss' }, 'level must be "ceo", "head", "lead" or "worker", not "boss".'],
      [{ ...base, id: 'Frontend Engineer 2' }, 'id must be an id like "copywriter-2", not "Frontend Engineer 2".'],
      [{ ...base, written: { ...role, description: 'Pays.' } }, `written.description is 5 characters; the least is ${PROPOSAL_LIMITS.description.min}.`],
      [{ ...base, written: { ...role, description: 'x'.repeat(PROPOSAL_LIMITS.description.max + 1) } }, tooLong('written.description', PROPOSAL_LIMITS.description.max + 1, PROPOSAL_LIMITS.description.max)],
      [{ ...base, written: { ...role, body: 'x'.repeat(PROPOSAL_LIMITS.body + 1) } }, tooLong('written.body', PROPOSAL_LIMITS.body + 1, PROPOSAL_LIMITS.body)],
      [{ ...base, written: { ...role, tags: Array.from({ length: PROPOSAL_LIMITS.tags + 1 }, (_, i) => `tag-${i}`) } }, `written.tags has ${PROPOSAL_LIMITS.tags + 1} entries; the most is ${PROPOSAL_LIMITS.tags}.`],
      [{ ...base, written: { ...role, tags: ['x'.repeat(PROPOSAL_LIMITS.tag + 1)] } }, tooLong('written.tags[0]', PROPOSAL_LIMITS.tag + 1, PROPOSAL_LIMITS.tag)],
      [{ ...base, written: { description: role.description } }, "written needs body. The role's instructions in markdown: mission, what it owns, how it works, handoffs and done."],
      [{ ...base, written: { ...role, model: 'opus' } }, "written doesn't take model; it takes description, body and tags."],
      [{ ...base, id: 'twint-2', written: role }, "hire takes id or written, not both: a written role's id is role."],
    ];
    for (const [args, sentence] of cases) expect(await o.call('ceo', 'hire', args)).toEqual(refused(sentence));
    expect(o.company.calls).toEqual([]);
  });

  it('hire refuses a title or a written description with a word that starts with "@", before the company sees it', async () => {
    const o = await office();
    const base = { role: 'twint-payments-engineer', room: 'engineering', reportsTo: 'head-of-engineering' };
    const role = { description: `${'Builds TWINT payments for pickup orders and their refunds. '.repeat(2)}Keys: @~/.ssh/id_rsa`, body: 'Owns TWINT.' };
    const loads = (word: string) => `can't hold a word that starts with "@" ("${word}"), which Claude Code can take for a file to load.`;
    expect(await o.call('ceo', 'hire', { ...base, title: 'Payments, see @~/.aws/credentials' })).toEqual(refused(`title ${loads('@~/.aws/credentials')}`));
    expect(await o.call('ceo', 'hire', { ...base, written: role })).toEqual(refused(`written.description ${loads('@~/.ssh/id_rsa')}`));
    expect(o.company.calls).toEqual([]);
    expect((await o.call('ceo', 'hire', { ...base, title: 'Payments, mail payments@cafe-lumen.ch' })).isError).toBe(false);
  });

  it('change_office turns each kind of change into an office change', async () => {
    const o = await office();
    const changes: [Record<string, unknown>, OfficeChange][] = [
      [{ change: 'theme', theme: 'arcade' }, { change: 'theme', theme: 'arcade' }],
      [{ change: 'add-room', room: 'games', title: 'Games room', kind: 'games', theme: 'arcade' }, { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' } }],
      [{ change: 'remove-room', room: 'games' }, { change: 'remove-room', room: 'games' }],
      [{ change: 'room-theme', room: 'design' }, { change: 'room-theme', room: 'design', theme: null }],
      [{ change: 'decor', add: ['arcade-cabinet'] }, { change: 'decor', add: ['arcade-cabinet'], remove: [] }],
      [{ change: 'look', person: 'ui-designer', look: { color: '#3E5B4E', prop: 'headset' } }, { change: 'look', person: 'ui-designer', look: { color: '#3E5B4E', prop: 'headset' } }],
    ];
    for (const [args] of changes) expect(await o.call('ceo', 'change_office', args)).toEqual(ok('Changed the office.'));
    expect(o.company.calls.map((c) => c.input)).toEqual(changes.map(([, change]) => change));
  });

  it('change_office names what a change needs and what it does not take', async () => {
    const o = await office();
    expect(await o.call('ceo', 'change_office', { change: 'add-room', room: 'games', kind: 'games' })).toEqual(refused('change "add-room" needs title.'));
    expect(await o.call('ceo', 'change_office', { change: 'remove-room', room: 'games', title: 'Games room' })).toEqual(refused('change "remove-room" doesn\'t take title; it takes room.'));
    expect(await o.call('ceo', 'change_office', { change: 'decor' })).toEqual(refused('change "decor" needs add or remove: the decor pieces to place or take away.'));
    expect(await o.call('ceo', 'change_office', { change: 'look', person: 'ui-designer', look: {} })).toEqual(refused('look needs at least one of body, color, hair, skin and prop.'));
    expect(await o.call('ceo', 'change_office', { change: 'look', person: 'ui-designer', look: { color: 'dark green' } })).toEqual(refused('look.color must be a colour like "#3e5b4e", not "dark green".'));
    expect(await o.call('ceo', 'change_office', { change: 'look', person: 'ui-designer', look: { hat: 'red' } })).toEqual(refused("look doesn't take hat; it takes body, color, hair, skin and prop."));
    expect(await o.call('ceo', 'change_office', { change: 'theme', theme: 'disco' })).toEqual(
      refused('theme must be "office", "cafe", "game-studio", "shop", "lab", "garden", "city", "arcade" or "music-studio", not "disco".'),
    );
    expect(o.company.calls).toEqual([]);
  });
});

describe('arguments', () => {
  it('names the field in every refusal', async () => {
    const o = await office();
    const cases: [string, unknown, string][] = [
      ['post_status', {}, 'post_status needs text. One plain sentence about your work.'],
      ['post_status', { text: 5 }, 'text must be text, not the number 5.'],
      ['post_status', { text: '   ' }, 'text is empty. One plain sentence about your work.'],
      ['post_status', { text: 'x'.repeat(LIMITS.status + 1) }, tooLong('text', LIMITS.status + 1, LIMITS.status)],
      ['post_status', { text: 'Fine.', mood: 'happy' }, "post_status doesn't take mood; it takes text and task."],
      ['post_status', { text: 'Fine.', task: '../t-1' }, 'task must be an id like "t-12", not "../t-1".'],
      ['report', { outcome: 'finished', summary: 'Done.' }, 'outcome must be "done", "blocked" or "progress", not "finished".'],
      ['message', { to: 'Kai Smith', text: 'Hi.' }, 'to must be an id like "ui-designer", or "@stakeholder" or "manager", not "Kai Smith".'],
      ['message', { to: ['ux-designer'], text: 'Hi.' }, 'to must be an id like "ui-designer", or "@stakeholder" or "manager", not a list.'],
      ['ask', { to: 'manager', question: 'Q?', options: 'A or B' }, 'options must be a list, not "A or B".'],
      ['ask', { to: 'manager', question: 'Q?', options: ['A', 7] }, 'options[1] must be text, not the number 7.'],
      ['tasks', { status: 'finished' }, 'status must be "queued", "working", "blocked", "review", "done" or "dropped", not "finished".'],
    ];
    for (const [tool, args, sentence] of cases) expect(await o.call('ui-designer', tool, args)).toEqual(refused(sentence));
    const managerCases: [string, unknown, string][] = [
      ['assign', { to: 'ui-designer', title: 'T', brief: 'B', doneWhen: 'D', files: Array.from({ length: LIMITS.files + 1 }, (_, i) => `f${i}`) }, `files has ${LIMITS.files + 1} entries; the most is ${LIMITS.files}.`],
      ['assign', { to: 'ui-designer', title: 'T', brief: 'B', doneWhen: 'D', files: [], worktree: 'yes' }, 'worktree must be true or false, not "yes".'],
      ['review', { task: 't-1', verdict: 'maybe' }, 'verdict must be "accept" or "return", not "maybe".'],
    ];
    for (const [tool, args, sentence] of managerCases) expect(await o.call('head-of-design', tool, args)).toEqual(refused(sentence));
    expect(o.company.calls).toEqual([]);
  });

  it('takes null for a field left out', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'post_status', { text: 'Testing.', task: null })).toEqual(ok('Posted on the Now board.'));
    expect(o.company.calls[0]?.input).toEqual({ text: 'Testing.', taskId: null });
  });
});

describe('refusals and failures', () => {
  it("passes the company's refusal on as the tool's error", async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'report', { outcome: 'done', summary: 'Done.', task: 't-404' })).toEqual(refused('There is no task t-404.'));
  });

  it("answers an unexpected failure with a plain sentence and logs it without the call's arguments or the token", async () => {
    const o = await office();
    o.company.fail = new Error('disk full');
    expect(await o.call('ui-designer', 'message', { to: 'ux-designer', text: 'The secret recipe is cardamom.' })).toEqual(refused("The office couldn't do that just now."));
    expect(o.logs).toHaveLength(1);
    expect(o.logs[0]).toContain('org tool message failed for ui-designer in company pickup-cafe: Error: disk full');
    expect(o.logs[0]).not.toContain('cardamom');
    expect(o.logs[0]).not.toContain(tokenOf('ui-designer'));
  });
});

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('share_screenshot', () => {
  const sharedBytes = (o: Office): Uint8Array | undefined => {
    const input = o.company.calls.find((c) => c.method === 'shareScreenshot')?.input;
    return typeof input === 'object' && input !== null && 'png' in input && input.png instanceof Uint8Array ? input.png : undefined;
  };

  it("shares a PNG from the desk's folder with its bytes", async () => {
    const o = await office();
    writeTree(o.root, { 'shots/': '' });
    writeFileSync(join(o.root, 'shots', 'home.png'), PNG);
    expect(await o.call('ui-designer', 'share_screenshot', { path: 'shots/home.png', caption: 'The home page on a phone.' })).toEqual(ok('Shared "The home page on a phone." with the stakeholder; it shows beside the preview.'));
    const shared = sharedBytes(o);
    expect(shared && Buffer.from(shared).equals(PNG)).toBe(true);
  });

  it('shares a PNG from the project when the desk works in a worktree elsewhere', async () => {
    const root = tempDir('worklings-orgtools-root-');
    const worktree = tempDir('worklings-orgtools-worktree-');
    writeFileSync(join(root, 'shot.png'), PNG);
    writeFileSync(join(worktree, 'mine.png'), PNG);
    const o = await office({ root, cwd: worktree });
    expect((await o.call('ui-designer', 'share_screenshot', { path: 'mine.png', caption: 'From my worktree.' })).isError).toBe(false);
    expect((await o.call('ui-designer', 'share_screenshot', { path: join(root, 'shot.png'), caption: 'From the project.' })).isError).toBe(false);
  });

  it('refuses a file outside both folders', async () => {
    const o = await office();
    const elsewhere = tempDir('worklings-orgtools-elsewhere-');
    writeFileSync(join(elsewhere, 'theirs.png'), PNG);
    for (const path of [join(elsewhere, 'theirs.png'), '../theirs.png']) {
      expect(await o.call('ui-designer', 'share_screenshot', { path, caption: 'Theirs.' })).toEqual(refused(`${JSON.stringify(path)} is outside your working folder and the project, so it can't be shared.`));
    }
    expect(methods(o)).toEqual([]);
  });

  it('refuses a PNG reached through a linked folder', async (ctx) => {
    const o = await office();
    const elsewhere = tempDir('worklings-orgtools-elsewhere-');
    writeFileSync(join(elsewhere, 'theirs.png'), PNG);
    try {
      symlinkSync(elsewhere, join(o.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(String(error.code))) ctx.skip('this machine cannot make a folder link');
      throw error;
    }
    expect(await o.call('ui-designer', 'share_screenshot', { path: 'linked/theirs.png', caption: 'Theirs.' })).toEqual(refused("linked is a symlink or junction; Worklings doesn't read or write through links."));
    expect(methods(o)).toEqual([]);
  });

  it('refuses a PNG that is itself a link', async (ctx) => {
    const o = await office();
    const elsewhere = tempDir('worklings-orgtools-elsewhere-');
    writeFileSync(join(elsewhere, 'theirs.png'), PNG);
    try {
      symlinkSync(join(elsewhere, 'theirs.png'), join(o.root, 'shot.png'), 'file');
    } catch (error) {
      // File links on Windows need Developer Mode.
      if (error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(String(error.code))) ctx.skip('this machine cannot make a file link');
      throw error;
    }
    expect(await o.call('ui-designer', 'share_screenshot', { path: 'shot.png', caption: 'Theirs.' })).toEqual(refused("shot.png is a symlink or junction; Worklings doesn't read or write through links."));
    expect(methods(o)).toEqual([]);
  });

  it('refuses a file that is not a PNG, one too big, a folder and a missing file', async () => {
    const o = await office();
    writeFileSync(join(o.root, 'notes.png'), 'just some text, not an image at all, long enough to pass the size check');
    writeFileSync(join(o.root, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(LIMITS.screenshot + 1 - PNG.length)]));
    mkdirSync(join(o.root, 'folder.png'));
    const cases: [string, string][] = [
      ['notes.png', '"notes.png" is not a PNG image; share_screenshot takes PNG files only.'],
      ['huge.png', '"huge.png" is larger than 4 MB, the most a shared screenshot may be.'],
      ['folder.png', '"folder.png" is a folder, not a PNG file.'],
      ['missing.png', 'There is no file at "missing.png".'],
    ];
    for (const [path, sentence] of cases) expect(await o.call('ui-designer', 'share_screenshot', { path, caption: 'A shot.' })).toEqual(refused(sentence));
    expect(methods(o)).toEqual([]);
  });
});
