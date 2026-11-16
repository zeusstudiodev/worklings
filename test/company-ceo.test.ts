import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LIMITS, OrgRefusal, STAKEHOLDER } from '../src/core/company.ts';
import type { Company } from '../src/company/index.ts';
import { crashCopy, ended, proposal, rig } from './company-kit.ts';

function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

const dashboard = (title = 'Launch checklist') => ({
  title,
  widgets: [
    { kind: 'stat', title: 'Pages live', value: 3, unit: 'pages' },
    { kind: 'list', title: 'Left to do', items: ['German menu', 'TWINT at pickup, key sk-ant-api03-abcdefghijklmnop1234'] },
  ],
});

describe('founding a company', () => {
  it('starts with the CEO alone, drafting the org from the prompt and what the folder holds', async () => {
    const { company, desks, org, root } = await rig();
    expect(readFileSync(join(root, '.worklings', '.gitignore'), 'utf8')).toBe('*\n');
    expect(org.calls.slice(0, 2)).toEqual(['found:A bilingual café website with pickup orders.', 'openingTurn']);
    const view = company.view();
    expect(view).toMatchObject({ phase: 'founding', name: 'Pickup Café', stakeholder: 'Robin', prompt: 'A bilingual café website with pickup orders.', inbox: 1 });
    expect(view.people.map((p) => p.id)).toEqual(['ceo']);
    const opening = desks().turns[0];
    expect(opening?.plan).toMatchObject({ person: { id: 'ceo' }, model: 'opus', sessionId: null });
    expect(desks().textsFor('ceo')[0]).toMatch(/^From the office: Draft the org for: A bilingual café website with pickup orders\.\nThe folder: A project called pickup-cafe/);
    expect(opening?.plan.systemPrompt).toContain('propose_org puts the org to Robin as a chart');
    expect(view.log.map((l) => l.kind)).toEqual(['founded']);
  });

  it('refuses a second company in the same folder', async () => {
    const { reopen, root, company } = await rig();
    expect(company.lobbyEntry().root).toBe(root);
    const again = reopen();
    expect(again.id).toBe(company.id);
  });
});

describe("the company's id and first prompt", () => {
  it("takes the hub's id and gives it to the switchboard from the start", async () => {
    const { company, boards } = await rig({ id: 'cafe-lumen-7' });
    expect(company.id).toBe('cafe-lumen-7');
    expect(boards[0]?.companyId).toBe('cafe-lumen-7');
    expect(company.lobbyEntry().id).toBe('cafe-lumen-7');
  });

  it.each([['cafe--lumen'], ['-cafe'], ['../cafe'], ['café'], ['a'.repeat(65)]])('refuses %s as a company id', async (id) => {
    await expect(rig({ id })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('makes an id from the folder when the hub gives none', async () => {
    const { company, boards } = await rig();
    expect(company.id).toMatch(/^worklings-company-[a-z0-9]+-[0-9a-f]{6}$/);
    expect(boards[0]?.companyId).toBe(company.id);
  });

  it('caps the first prompt', async () => {
    const { company } = await rig({ prompt: `A café website. ${'More detail. '.repeat(5_000)}` });
    expect(company.view().prompt.length).toBe(LIMITS.prompt);
  });
});

describe('the proposal', () => {
  it('gives errors back to the CEO and keeps drafting', async () => {
    const { company } = await rig();
    expect(company.proposeOrg('ceo', { company: 'Too small', people: [] })).toEqual({ ok: false, errors: ['An org has 2 to 25 people; this one has 0.'] });
    expect(company.view().phase).toBe('founding');
  });

  it('counts the drafts the office turned down while founding, with the first one\'s reason, until the CEO proposes', async () => {
    const { company } = await rig();
    expect(company.view().drafting).toEqual({ refused: 0, firstRefusal: null, stopped: null });
    company.proposeOrg('ceo', 'An org of eight, in three rooms.');
    company.proposeOrg('ceo', proposal({ people: proposal().people.slice(0, 1) }));
    expect(company.view().drafting).toEqual({ refused: 2, firstRefusal: 'The proposal needs a company name and a list of people.', stopped: null });
    expect(company.proposeOrg('ceo', proposal()).ok).toBe(true);
    expect(company.view().drafting).toBeNull();
  });

  it('says the CEO stopped without a proposal, with its last words, until a message reaches it, and after a restart', async () => {
    const r = await rig({ now: () => Date.now() });
    const board = r.desks();
    const opening = board.turns[0]?.turn.messageId ?? '';
    board.events.delivered(opening, Date.now());
    expect(r.company.view().drafting?.stopped).toBeNull();
    // The CEO answers with a question in plain text and stops: no proposal, and nothing else will come.
    board.events.turn('ceo', ended('Should the site be in German and English, or English only?'));
    expect(r.company.view().drafting?.stopped).toEqual({ at: expect.any(Number), words: 'Should the site be in German and English, or English only?' });
    expect(r.reopen(crashCopy(r.root)).view().drafting?.stopped?.words).toBe('Should the site be in German and English, or English only?');
    const answer = r.company.say('ceo', 'German and English.');
    board.events.delivered(answer.id, Date.now());
    expect(r.company.view().drafting).toEqual({ refused: 0, firstRefusal: null, stopped: null });
  });

  it('waits for the stakeholder with its questions in the inbox, and a revision withdraws the old ones', async () => {
    const { company } = await rig();
    const first = company.proposeOrg('ceo', proposal());
    expect(first.ok).toBe(true);
    const view = company.view();
    expect(view.phase).toBe('proposed');
    expect(view.questions.filter((q) => !q.preset).map((q) => [q.from, q.text, q.options, q.recommended])).toEqual([['ceo', 'Which payment provider at pickup?', ['Stripe', 'TWINT'], 1]]);
    // One question, the proposal itself and the office's "How thorough?", which stays open beside the chart.
    expect(view.inbox).toBe(3);
    expect(view.log.at(-1)).toMatchObject({ kind: 'proposal', text: 'The CEO proposed an org of 8 people in 3 rooms.' });
    company.proposeOrg('ceo', proposal({ questions: [{ text: 'Open on Sundays?', options: ['Yes', 'No'] }] }));
    const revised = company.view();
    expect(revised.questions.filter((q) => !q.preset).map((q) => [q.text, q.withdrawn?.reason ?? null])).toEqual([
      ['Which payment provider at pickup?', 'The CEO revised its proposal.'],
      ['Open on Sundays?', null],
    ]);
    expect(revised.log.at(-1)?.text).toBe('The CEO revised its proposal: 8 people in 3 rooms.');
  });

  it("takes the stakeholder's edit, tells the CEO what changed, and goes back to the CEO's version", async () => {
    const { company, desks } = await rig();
    company.proposeOrg('ceo', proposal());
    const edited = proposal();
    edited.people.push({ id: 'copywriter', name: 'Lena', title: 'German copywriter', level: 'worker', room: 'design', reportsTo: 'head-of-design', model: 'sonnet', owns: 'The German copy.' });
    expect(company.editProposal(edited).ok).toBe(true);
    expect(company.view()).toMatchObject({ proposalEdited: true });
    expect(company.view().proposal?.people).toHaveLength(9);
    expect(desks().textsFor('ceo').at(-1)).toBe('From the office: Robin edited your proposal: added Lena, German copywriter. Build on this version if you revise it.');
    expect(company.view().log.at(-1)?.text).toBe('You edited the proposal: added Lena, German copywriter.');
    expect(company.editProposal({ company: 'Broken', people: 'nobody' }).ok).toBe(false);
    expect(company.restoreProposal().people).toHaveLength(8);
    expect(company.view()).toMatchObject({ proposalEdited: false });
    expect(desks().textsFor('ceo').at(-1)).toBe("From the office: Robin went back to your own version of the proposal.");
  });

  it("holds the CEO's proposals to the org's size, and not the stakeholder's own edit", async () => {
    const { company, org } = await rig();
    const small = proposal({ people: proposal().people.slice(0, 1) });
    expect(company.proposeOrg('ceo', small).ok).toBe(false);
    company.proposeOrg('ceo', proposal());
    expect(company.editProposal(small).ok).toBe(true);
    expect(company.view().proposal?.people.map((p) => p.id)).toEqual(['ceo']);
    expect(org.calls.filter((c) => c.startsWith('check'))).toEqual(['check', 'check', 'check:any-size']);
  });

  it("starts the company: writes the org, prepares the branch and gives the CEO the start turn", async () => {
    const { company, desks, git, org, root } = await rig();
    expect(refusal(() => company.start()).message).toBe("The CEO hasn't proposed an org yet, so there's nobody to hire.");
    expect(company.view().starting).toBe(false);
    company.proposeOrg('ceo', proposal());
    git.hold = true;
    company.start();
    expect(org.calls).toContain('write');
    // It runs once git has put the project on the company's branch; until then nothing else changes the proposal.
    expect(company.view()).toMatchObject({ phase: 'proposed', starting: true });
    expect(refusal(() => company.start()).code).toBe('busy');
    expect(refusal(() => company.editProposal(proposal())).code).toBe('busy');
    await vi.waitFor(() => expect(git.calls[0]).toEqual(['prepareBranch', root, company.id]));
    git.hold = false;
    git.release();
    await company.idle();
    const view = company.view();
    expect(view).toMatchObject({ phase: 'running', starting: false, branch: 'worklings/test', theme: 'cafe', inbox: 0 });
    expect(view.people.map((p) => p.name)).toEqual(['Noor', 'Ada', 'Kai', 'Lea', 'Ben', 'Ola', 'Sam', 'Tia']);
    expect(view.people.find((p) => p.id === 'ux-designer')?.model).toBe('haiku');
    // The question left open goes with the CEO's pick, and the CEO hears so.
    expect(view.questions.find((q) => !q.preset)?.withdrawn?.reason).toBe("The company started with the CEO's pick.");
    expect(view.questions.find((q) => q.preset)?.withdrawn?.reason).toBe('The company started as Balanced.');
    const start = desks().textsFor('ceo').at(-1) ?? '';
    expect(start).toMatch(/^From the office: Robin started the company\./);
    expect(start).toContain('First set the goal with set_goal');
    expect(start).toContain('"Which payment provider at pickup?" (your pick: TWINT)');
    expect(start).toContain('the branch worklings/test, and nobody pushes');
    expect(refusal(() => company.start()).code).toBe('closed');
    expect(refusal(() => company.proposeOrg('ceo', proposal())).code).toBe('closed');
  });
});

describe("the CEO's tools", () => {
  it.each([
    ['propose the org', (c: Company) => c.proposeOrg('head-of-design', proposal())],
    ['ask the stakeholder directly', (c: Company) => c.askStakeholder('head-of-design', { text: 'Why?', options: ['A', 'B'], recommended: null, taskId: null })],
    ['set the goal', (c: Company) => c.setGoal('head-of-design', { text: 'Ship.', milestones: [] })],
    ['publish dashboards', (c: Company) => c.publishDashboard('head-of-design', dashboard())],
    ['hire people', (c: Company) => c.hire('head-of-design', { role: 'copywriter', room: 'design', reportsTo: 'head-of-design', name: 'Lena', title: 'German copywriter' })],
    ['fire people', (c: Company) => c.fire('head-of-design', 'ui-designer')],
    ['move people', (c: Company) => c.move('head-of-design', { role: 'ui-designer', room: 'engineering', reportsTo: null })],
    ['rehire people', (c: Company) => c.rehire('head-of-design', 'ui-designer')],
    ['read the library', (c: Company) => c.libraryCatalogue('head-of-design')],
  ])('refuses anyone but the CEO who tries to %s', async (what, call) => {
    const { company, org } = await rig({ running: true });
    const before = org.calls.length;
    expect(refusal(() => call(company))).toMatchObject({ code: 'not-allowed', message: `Only the CEO can ${what}.` });
    expect(org.calls.length).toBe(before);
  });

  it('lets the CEO, the office manager and the stakeholder change the office, and nobody else', async () => {
    const { company, org } = await rig({ running: true });
    expect(refusal(() => company.changeOffice('ui-designer', { change: 'theme', theme: 'arcade' })).message).toBe('Only the CEO and the office manager change the office.');
    expect(company.changeOffice('office-manager', { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' } }).ok).toBe(true);
    expect(company.changeOffice('ceo', { change: 'theme', theme: 'garden' }).ok).toBe(true);
    expect(company.changeOffice(STAKEHOLDER, { change: 'theme', theme: 'cafe' }).ok).toBe(true);
    expect(org.calls.filter((c) => c.startsWith('office:'))).toEqual(['office:add-room', 'office:theme', 'office:theme']);
    const view = company.view();
    expect(view.rooms).toEqual([{ id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' }]);
    expect(view.theme).toBe('cafe');
    expect(view.log.slice(-3).map((l) => l.text)).toEqual(['Tia added the room Games room.', 'The CEO made the office a garden.', 'You made the office a café.']);
  });

  it('sets the goal with milestones, keeping the ids of the ones it keeps', async () => {
    const { company } = await rig({ running: true });
    const first = company.setGoal('ceo', { text: 'Pickup orders work.', milestones: [{ title: 'Menu pages live', doneWhen: 'They load.' }, { title: 'Orders', doneWhen: 'One goes through.' }] });
    expect(first.milestones.map((m) => m.id)).toEqual(['ms-1', 'ms-2']);
    const second = company.setGoal('ceo', { text: 'Pickup orders work.', milestones: [{ title: 'Orders', doneWhen: 'Ten go through.' }, { title: 'Launch', doneWhen: 'It is live.' }] });
    expect(second.milestones.map((m) => [m.id, m.title])).toEqual([['ms-2', 'Orders'], ['ms-3', 'Launch']]);
    expect(company.view().log.at(-1)?.text).toBe('The CEO set the goal (2 milestones): Pickup orders work.');
  });

  it('publishes a dashboard stamped by the office, refuses a malformed one with a sentence, and updates by title', async () => {
    const { company } = await rig({ running: true });
    const refused = company.publishDashboard('ceo', { title: 'Broken', widgets: [{ kind: 'line', title: 'Orders', points: [] }] });
    expect(refused).toEqual({ ok: false, error: "Widget 1 needs points as a list with at least one entry." });
    expect(company.view().log.at(-1)).toMatchObject({ kind: 'dashboard-refused', text: "The office turned down the CEO's dashboard “Broken”: Widget 1 needs points as a list with at least one entry." });
    const published = company.publishDashboard('ceo', dashboard());
    if (!published.ok) throw new Error(published.error);
    expect(published.dashboard).toMatchObject({ id: 'd-1', title: 'Launch checklist', by: 'ceo', publishedAt: expect.any(Number) });
    expect(JSON.stringify(published.dashboard)).not.toContain('sk-ant-');
    const updated = company.publishDashboard('ceo', { ...dashboard(), widgets: [{ kind: 'stat', title: 'Pages live', value: 4 }] });
    expect(updated.ok && updated.dashboard.id).toBe('d-1');
    expect(company.view().dashboards).toHaveLength(1);
    expect(company.view().log.at(-1)?.text).toBe('The CEO updated the dashboard “Launch checklist”.');
  });

  it('takes a dashboard down for the CEO or the stakeholder, and for nobody else', async () => {
    const { company } = await rig({ running: true });
    const first = company.publishDashboard('ceo', dashboard('Launch'));
    const second = company.publishDashboard('ceo', dashboard('Orders'));
    if (!first.ok || !second.ok) throw new Error('Expected both to publish.');
    expect(refusal(() => company.removeDashboard('head-of-design', first.dashboard.id))).toMatchObject({ code: 'not-allowed', message: 'Only the CEO can take dashboards down.' });
    expect(refusal(() => company.removeDashboard('ceo', 'd-99')).code).toBe('unknown');
    expect(company.removeDashboard('ceo', first.dashboard.id).title).toBe('Launch');
    expect(company.view().log.at(-1)).toMatchObject({ kind: 'dashboard', by: 'ceo', text: 'The CEO took down the dashboard “Launch”.' });
    company.removeDashboard(STAKEHOLDER, second.dashboard.id);
    expect(company.view().log.at(-1)?.text).toBe('You took down the dashboard “Orders”.');
    expect(company.view().dashboards).toEqual([]);
  });

  it('keeps a proposal beside the log, so one past the size of a log line still goes through', async () => {
    const { company, root } = await rig();
    const big = proposal();
    for (const p of big.people) p.owns = `${p.title}: ${'the whole area, every part of it. '.repeat(1_200)}`;
    expect(company.proposeOrg('ceo', big).ok).toBe(true);
    expect(company.view().proposal?.people[0]?.owns.length).toBeGreaterThan(30_000);
    const line = readFileSync(join(root, '.worklings', 'events.jsonl'), 'utf8').trimEnd().split('\n').at(-1) ?? '';
    expect(line.length).toBeLessThan(8_000);
    expect(line).toMatch(/"ref":\{"n":1,"hash":"[0-9a-f]{64}"\}/);
    expect(readFileSync(join(root, '.worklings', 'proposals', '1.json'), 'utf8').length).toBeGreaterThan(256 * 1024);
  });

  it('hires, moves, fires and rehires through the org flow, and reloads the people each time', async () => {
    const { company, desks, org } = await rig({ running: true });
    expect(company.hire('ceo', { role: 'copywriter', room: 'design', reportsTo: 'head-of-design', name: 'Lena', title: 'German copywriter' }).ok).toBe(true);
    expect(company.people().find((p) => p.id === 'copywriter')).toMatchObject({ name: 'Lena', reportsTo: 'head-of-design' });
    expect(company.move(STAKEHOLDER, { role: 'copywriter', room: 'direction', reportsTo: 'ceo' }).ok).toBe(true);
    expect(company.people().find((p) => p.id === 'copywriter')).toMatchObject({ room: 'direction', reportsTo: 'ceo' });

    // Kai has work and a request open when he is fired.
    desks().events.session('ui-designer', '0b7c1d2e-0000-4000-8000-00000000000a');
    const task = company.assign('head-of-design', { to: 'ui-designer', title: 'Palette', brief: 'Darker.', files: ['src/theme'], doneWhen: 'It is darker.', parent: null, milestone: null, worktree: false });
    void company.requestApproval('ui-designer', { tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push', kind: 'push', expiresAt: Date.now() + 600_000, alwaysRule: null });
    expect(company.fire('ceo', 'ui-designer').ok).toBe(true);
    expect(org.calls).toContain('fire:ui-designer');
    expect(desks().closed).toEqual(['ui-designer']);
    const view = company.view();
    expect(view.people.some((p) => p.id === 'ui-designer')).toBe(false);
    expect(view.tasks.find((t) => t.id === task.id)).toMatchObject({ status: 'dropped', outcome: 'Kai was fired before it was done.' });
    expect(view.approvals.at(-1)?.withdrawn?.reason).toBe('Kai was fired.');
    expect(desks().textsFor('head-of-design').at(-1)).toBe(`From the office: Kai was fired, so their task ${task.id}, "Palette", was dropped. Assign it again if it still matters.`);
    expect(view.log.at(-1)).toMatchObject({ kind: 'fire', text: 'The CEO fired Kai, UI designer.' });

    expect(company.rehire('ceo', 'ui-designer').ok).toBe(true);
    company.say('ui-designer', 'Welcome back.');
    // Back on the session they had.
    expect(desks().turns.at(-1)?.plan).toMatchObject({ person: { id: 'ui-designer' }, sessionId: '0b7c1d2e-0000-4000-8000-00000000000a' });
  });

  it("runs without a work branch when git can't make one, and says why in the timeline", async () => {
    const { company, git, desks } = await rig();
    git.branch = null;
    company.proposeOrg('ceo', proposal());
    company.start();
    await company.idle();
    expect(company.view()).toMatchObject({ phase: 'running', branch: null, problem: null });
    expect(company.view().log.find((l) => l.kind === 'started')?.text).toBe("You started the company without a work branch: The folder isn't a git repository.");
    expect(desks().textsFor('ceo').at(-1)).toContain("There is no work branch (The folder isn't a git repository.), so finished work isn't committed. Don't ask Robin about it: carry on, and say so in your handover.");
  });

  it("passes the org flow's refusals on as they are, and logs nothing for them", async () => {
    const { company } = await rig({ running: true });
    const before = company.view().log.length;
    const refused = refusal(() => company.hire('ceo', { role: 'ui-designer', room: 'design', reportsTo: 'head-of-design', name: null, title: null }));
    expect(refused).toMatchObject({ code: 'conflict', message: 'ui-designer is on staff already.' });
    expect(refusal(() => company.rehire('ceo', 'nobody')).code).toBe('unknown');
    expect(refusal(() => company.changeOffice('ceo', { change: 'decor', add: ['plants'], remove: [] })).code).toBe('invalid');
    expect(company.view().log.length).toBe(before);
  });

  it('hires a second person from the same library role under their own id', async () => {
    const { company } = await rig({ running: true });
    company.hire('ceo', { role: 'frontend-engineer', id: 'frontend-engineer-2', room: 'engineering', reportsTo: 'frontend-lead', name: 'Ivo', title: 'Frontend engineer' });
    expect(company.people().find((p) => p.id === 'frontend-engineer-2')).toMatchObject({ name: 'Ivo', reportsTo: 'frontend-lead' });
    expect(company.view().log.at(-1)?.text).toBe('The CEO hired Ivo, frontend engineer.');
  });

  it("brings a rehired manager's people back to them", async () => {
    const { company } = await rig({ running: true });
    company.fire('ceo', 'head-of-design');
    expect(company.people().filter((p) => p.reportsTo === 'ceo').map((p) => p.id)).toEqual(expect.arrayContaining(['ui-designer', 'ux-designer']));
    company.rehire('ceo', 'head-of-design');
    expect(company.people().filter((p) => p.reportsTo === 'head-of-design').map((p) => p.id)).toEqual(['ui-designer', 'ux-designer']);
    // Kai can message Ada again, as his manager.
    expect(company.message('ui-designer', 'head-of-design', 'Welcome back.').to).toBe('head-of-design');
  });

  it("takes a firing back when the log can't keep its line, so studio.yaml and the log agree after a restart", async () => {
    const r = await rig({ running: true });
    // Hundreds of open tasks with long titles: firing Sam drops each one and tells Ola why, in one line too big to keep.
    const title = '菜单页面'.repeat(30);
    for (let i = 0; i < 400; i += 1) {
      r.company.assign('frontend-lead', { to: 'frontend-engineer', title, brief: 'Translate the menu.', files: [], doneWhen: 'It reads well.', parent: null, milestone: null, worktree: false });
    }
    expect(refusal(() => r.company.fire(STAKEHOLDER, 'frontend-engineer')).message).toMatch(/^That is too big for the office to keep/);
    expect(r.company.people().find((p) => p.id === 'frontend-engineer')).toMatchObject({ name: 'Sam', reportsTo: 'frontend-lead' });
    expect(r.company.view().log.some((l) => l.kind === 'fire')).toBe(false);
    // Taken back through the org flow, which alone writes .claude/.
    expect(r.org.calls.slice(-2)).toEqual(['fire:frontend-engineer', 'rehire:frontend-engineer']);
    await r.company.close();
    const again = r.reopen();
    expect(again.people().find((p) => p.id === 'frontend-engineer')).toMatchObject({ name: 'Sam', reportsTo: 'frontend-lead' });
    expect(again.view().tasks.filter((t) => t.owner === 'frontend-engineer' && t.status === 'queued')).toHaveLength(400);
    await again.close();
  });

  it("can't fire the CEO, and changes the org only once the company runs", async () => {
    const running = await rig({ running: true });
    expect(running.company.fire(STAKEHOLDER, 'ceo')).toEqual({ ok: false, message: "The CEO can't be fired: the company needs one.", changed: [] });
    const founding = await rig();
    expect(refusal(() => founding.company.hire('ceo', { role: 'x', room: 'direction', reportsTo: 'ceo', name: null, title: null })).code).toBe('closed');
  });

  it('lists the library for the CEO and the stakeholder', async () => {
    const { company } = await rig({ running: true });
    expect(company.libraryCatalogue('ceo').map((r) => r.id)).toEqual(['ui-designer']);
    expect(company.libraryCatalogue(STAKEHOLDER)).toHaveLength(1);
  });
});
