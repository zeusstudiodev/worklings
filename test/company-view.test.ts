import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEW_LIMITS } from '../src/core/company.ts';
import { summaryInputOfView, summaryOf } from '../src/core/overview.ts';
import { rig } from './company-kit.ts';

describe("what the office sees of a company", () => {
  it('tells listeners once per change, however many lines it took, until they unsubscribe', async () => {
    const { company } = await rig({ running: true });
    let heard = 0;
    const stop = company.onChange(() => {
      heard += 1;
    });
    company.relay('ceo', { message: company.say('ceo', 'Make the palette darker.').id, to: ['head-of-design', 'head-of-engineering'], note: null });
    await Promise.resolve();
    expect(heard).toBe(1);
    stop();
    company.say('ceo', 'Thanks.');
    await Promise.resolve();
    expect(heard).toBe(1);
  });

  it("shows each person's desk, task, latest status and cost, and the desks at work", async () => {
    const { company, desks } = await rig({ running: true });
    company.postStatus('ui-designer', 'Trying a darker navy.', null);
    desks().views = [
      { person: 'ui-designer', state: 'working', sessionId: '0b7c1d2e-0000-4000-8000-000000000001', since: 1, context: 0.4, problem: null, queue: null },
      { person: 'ux-designer', state: 'waiting', sessionId: null, since: 2, context: null, problem: null, queue: 1 },
    ];
    const view = company.view();
    expect(view.desks).toEqual({ working: 1, waiting: 1, max: 5 });
    const kai = view.people.find((p) => p.id === 'ui-designer');
    expect(kai).toMatchObject({ name: 'Kai', model: 'sonnet', agentKey: null, cost: 0, status: { text: 'Trying a darker navy.' }, desk: { state: 'working', context: 0.4 } });
    expect(view.people.find((p) => p.id === 'head-of-design')?.desk).toMatchObject({ state: 'closed', sessionId: null, queue: null });
    expect(view.preview).toEqual({ state: 'off', url: null, command: null, problem: null });
    expect(view.problem).toBeNull();
    const lobby = company.lobbyEntry();
    expect(lobby).toMatchObject({ id: company.id, name: 'Pickup Café', phase: 'running', theme: 'cafe', working: 1, waiting: 1, needsYou: 0, spend: 0, latest: { text: 'Trying a darker navy.' }, problem: null });
    expect(lobby.people.find((p) => p.id === 'ux-designer')?.state).toBe('waiting');
  });

  it('gives the lobby card and the progress view the same people at work and the same spend', async () => {
    const { company, desks } = await rig({ running: true });
    // Starting a turn and finishing one count as at work, as the lobby's own count says; a desk waiting for room doesn't.
    desks().views = [
      { person: 'ui-designer', state: 'starting', sessionId: null, since: 1, context: null, problem: null, queue: null },
      { person: 'head-of-design', state: 'stopping', sessionId: null, since: 2, context: null, problem: null, queue: null },
      { person: 'ux-designer', state: 'waiting', sessionId: null, since: 3, context: null, problem: null, queue: 1 },
    ];
    const lobby = company.lobbyEntry().summary;
    const progress = summaryOf(summaryInputOfView(company.view()), Date.now());
    expect(lobby?.working.map((w) => w.name).sort()).toEqual(['Ada', 'Kai']);
    expect(progress.working).toEqual(lobby?.working);
    expect(progress.spend).toEqual(lobby?.spend);
  });

  it("bills as Claude Code says it is signed in: a plan's costs are estimates, an API key's are real", async () => {
    const { company, desks } = await rig({ running: true });
    expect(company.view().settings.billing).toBe('plan');
    desks().events.session('ui-designer', '0b7c1d2e-0000-4000-8000-00000000000c', { apiKeySource: 'ANTHROPIC_API_KEY' });
    expect(company.view().settings.billing).toBe('api-key');
    desks().events.session('ui-designer', '0b7c1d2e-0000-4000-8000-00000000000c', { apiKeySource: 'none' });
    expect(company.view().settings.billing).toBe('plan');
    // A desk that doesn't say leaves the setting as it was.
    desks().events.session('ux-designer', '0b7c1d2e-0000-4000-8000-00000000000d');
    expect(company.view().settings.billing).toBe('plan');
  });

  it('caps its lists, newest kept, and keeps every open question whatever its age', async () => {
    const { company } = await rig({ running: true });
    const first = company.askStakeholder('ceo', { text: 'The oldest question?', options: ['Yes', 'No'], recommended: null, taskId: null });
    for (let i = 0; i < VIEW_LIMITS.statuses + 5; i += 1) company.postStatus('ui-designer', `Step ${i}.`, null);
    for (let i = 0; i < VIEW_LIMITS.questions + 5; i += 1) {
      const q = company.askStakeholder('ceo', { text: `Question ${i}?`, options: ['Yes', 'No'], recommended: null, taskId: null });
      company.answer(q.id, { option: 0, text: '' });
    }
    const view = company.view();
    expect(view.statuses).toHaveLength(VIEW_LIMITS.statuses);
    expect(view.statuses.at(-1)?.text).toBe(`Step ${VIEW_LIMITS.statuses + 4}.`);
    expect(view.questions).toHaveLength(VIEW_LIMITS.questions);
    expect(view.questions[0]?.id).toBe(first.id);
    expect(view.inbox).toBe(1);
  });

  it('says what keeps the company from running', async () => {
    const { company, reopen, root } = await rig({ running: true });
    await company.close();
    writeFileSync(join(root, '.claude', 'studio.yaml'), 'version: 1\nname: Pickup Café\nroles: [}\n');
    const broken = reopen();
    expect(broken.view().problem).toMatch(/^studio\.yaml has a mistake \(studio\.yaml is not valid YAML/);
    expect(broken.lobbyEntry().problem).toBe(broken.view().problem);
    await broken.close();
  });

  it("doesn't offer an Always allow rule that would carry a secret", async () => {
    const { company } = await rig({ running: true });
    void company.requestApproval('frontend-engineer', {
      tool: 'Bash',
      summary: 'Call the payments API',
      detail: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnop1234" https://api.example.com',
      kind: 'paid-api',
      expiresAt: Date.now() + 600_000,
      alwaysRule: { rule: 'Bash(curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnop1234" https://api.example.com)', sentence: 'this exact call' },
    });
    const approval = company.view().approvals.at(-1);
    expect(approval?.alwaysRule).toBeNull();
    expect(approval?.detail).not.toContain('sk-ant-');
  });
});
