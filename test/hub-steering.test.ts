// The stakeholder's steering routes, through the real hub with the hub kit's fakes and a fake SteeringApi on the
// company: each route with good input and what reached the company as the stakeholder, each body refused with its
// sentence, the caps, the company's refusals with their status, and no route at all before the company serves steering.
import { realpathSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { OrgRefusal, STAKEHOLDER, type Task } from '../src/core/company.ts';
import { DECISION_LIMITS, PLAN_LIMITS } from '../src/core/steering.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import { type FakeCompany, fakes, person, TOKEN } from './hub-kit.ts';
import { miniLibrary, tempDir } from './library-kit.ts';
import { type SteeringFake, steeringFake } from './orgtools-steering-kit.ts';

const library = loadLibrary(miniLibrary());
const hubs: RunningHub[] = [];
afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.close();
});

function raw(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

const task = (id: string, owner: string, title: string): Task => ({
  id, title, brief: `Brief for ${title}.`, owner, askedBy: 'ceo', files: [], doneWhen: 'It works.', status: 'queued', outcome: null, parent: null, milestone: null,
  worktree: null, commit: null, createdAt: 1, updatedAt: 1,
});

interface Steered {
  port: number;
  id: string;
  company: FakeCompany;
  steering: SteeringFake;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> & { error?: string } }>;
}

/** A hub with one company; with `steering`, the company serves steering through the fake. */
async function hub(o: { steering?: boolean } = {}): Promise<Steered> {
  const f = fakes();
  const running = await startHub({
    port: 0, token: TOKEN, webDir: null, library, home: tempDir('worklings-hubhome-'), make: f.make, tickMs: 10, claudeHome: tempDir('worklings-claude-'),
    aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') },
  });
  hubs.push(running);
  const root = join(realpathSync.native(tempDir('worklings-projects-')), 'pickup-cafe');
  const call = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    raw(running.port, path, {
      method: 'POST',
      headers: { host: `127.0.0.1:${running.port}`, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const created = await call('/api/companies', { folder: root, prompt: 'A café site with pickup orders' });
  expect(created.status).toBe(201);
  const id = String((JSON.parse(created.body) as { id: string }).id);
  const company = f.byRoot(root);
  if (!company) throw new Error('the hub made no company');
  company.state.people = [person('ceo', { room: 'direction' }), person('ux-designer'), person('ui-designer')];
  company.state.tasks = [task('t-1', 'ux-designer', 'Map the pickup flow'), task('t-2', 'ui-designer', 'Build the streak card')];
  const steering = steeringFake({ people: () => company.state.people, messages: () => company.state.messages, tasks: () => company.state.tasks, now: () => 1_000 });
  if (o.steering) Object.assign(company, steering);
  return {
    port: running.port,
    id,
    company,
    steering,
    post: async (path, body, headers) => {
      const answer = await call(`/api/c/${id}/${path}`, body, headers);
      return { status: answer.status, json: answer.body ? (JSON.parse(answer.body) as Record<string, unknown>) : {} };
    },
  };
}

const steeredBy = (h: Steered) => h.steering.steered.map((c) => [c.method, c.by, c.input]);
const PLAN = {
  goal: 'Take pickup orders online.',
  milestones: [{ id: 'ms-1', title: 'Pickup works', doneWhen: 'A guest can order.' }],
  tasks: [{ id: 'p-1', title: 'Map the pickup flow', owner: 'ux-designer', files: ['docs/flow.md'], milestone: 'ms-1', after: [], brief: 'Map it.', doneWhen: 'Reviewed.' }],
};

describe('before the company serves steering', () => {
  it('has no steering routes, and the settings route takes only what it took before', async () => {
    const h = await hub();
    expect((await h.post('plan', { plan: PLAN, note: null })).status).toBe(404);
    expect((await h.post('tasks/t-1/pause', {})).status).toBe(404);
    expect(await h.post('settings', { planApproval: 'milestones' })).toMatchObject({ status: 400, json: { error: 'This takes maxDesks, removeRule, not planApproval.' } });
    expect(h.steering.steered).toEqual([]);
  });
});

describe('the plan', () => {
  it("takes the stakeholder's edit as a new version", async () => {
    const h = await hub({ steering: true });
    const saved = await h.post('plan', { plan: PLAN, note: 'Shorter first milestone.' });
    expect(saved).toMatchObject({ status: 200, json: { ok: true, version: { version: 1, by: STAKEHOLDER, note: 'Shorter first milestone.' } } });
    expect(steeredBy(h)).toEqual([['editPlan', STAKEHOLDER, { plan: PLAN, note: 'Shorter first milestone.' }]]);
  });

  it("answers 400 with the check's sentences for a plan that doesn't check out, and refuses a body without one", async () => {
    const h = await hub({ steering: true });
    h.steering.refusePlans(['tasks[0].owner: "nobody" is nobody in the company']);
    expect(await h.post('plan', { plan: PLAN })).toMatchObject({ status: 400, json: { ok: false, errors: ['tasks[0].owner: "nobody" is nobody in the company'], error: 'tasks[0].owner: "nobody" is nobody in the company' } });
    expect(await h.post('plan', { note: 'Only a note.' })).toMatchObject({ status: 400, json: { error: 'Send the plan.' } });
    expect(await h.post('plan', { plan: PLAN, note: 'n'.repeat(PLAN_LIMITS.note + 1) })).toMatchObject({ status: 400, json: { error: 'note is longer than 1,000 characters.' } });
    expect(await h.post('plan', { plan: PLAN, by: 'ceo' })).toMatchObject({ status: 400, json: { error: 'This takes plan, note, not by.' } });
    expect((await h.post('plan', { plan: PLAN, padding: 'x'.repeat(513 * 1024) })).status).toBe(413);
  });

  it('approves the latest version, through a milestone, and answers 409 for an older one', async () => {
    const h = await hub({ steering: true });
    await h.post('plan', { plan: PLAN });
    await h.post('plan', { plan: PLAN, note: 'Again.' });
    expect(await h.post('plan/approve', { version: 2, through: 'ms-1' })).toMatchObject({ status: 200, json: { version: 2, through: 'ms-1', by: STAKEHOLDER, cites: [] } });
    expect(await h.post('plan/approve', { version: 1, through: null })).toMatchObject({ status: 409, json: { error: "Version 1 isn't the latest: approve version 2.", code: 'conflict' } });
    expect(await h.post('plan/approve', { version: 0 })).toMatchObject({ status: 400, json: { error: 'version must be a whole number from 1 to 1,000,000.' } });
  });

  it('takes a comment on the plan, a milestone or a task', async () => {
    const h = await hub({ steering: true });
    await h.post('plan', { plan: PLAN });
    expect(await h.post('plan/comment', { on: { kind: 'task', id: 'p-1' }, text: 'Do the flow on paper first.' })).toMatchObject({ status: 200, json: { on: { kind: 'task', id: 'p-1' }, by: STAKEHOLDER } });
    expect((await h.post('plan/comment', { on: { kind: 'plan' }, text: 'Looks right.' })).status).toBe(200);
    expect(await h.post('plan/comment', { on: { kind: 'chapter', id: 'x' }, text: 'Hm.' })).toMatchObject({ status: 400, json: { error: 'kind must be "plan" or "milestone" or "task".' } });
    expect(await h.post('plan/comment', { on: { kind: 'plan', id: 'p-1' }, text: 'Hm.' })).toMatchObject({ status: 400, json: { error: 'This takes kind, not id.' } });
    expect(await h.post('plan/comment', { on: { kind: 'plan' }, text: 'c'.repeat(PLAN_LIMITS.comment + 1) })).toMatchObject({ status: 400, json: { error: 'text is longer than 2,000 characters.' } });
  });
});

describe('messages', () => {
  it('sends to a person, a room, a team or everyone, and names whom it is for', async () => {
    const h = await hub({ steering: true });
    const sent = await h.post('send', { to: { kind: 'room', id: 'design' }, text: 'The palette goes darker.', for: ['ui-designer'] });
    expect(sent.status).toBe(202);
    expect(sent.json.ids).toEqual(['m-1', 'm-2']);
    expect(sent.json.messages).toMatchObject([{ to: 'ux-designer', audience: { kind: 'room', id: 'design' } }, { to: 'ui-designer' }]);
    expect((await h.post('send', { to: { kind: 'everyone' }, text: 'We open Monday.' })).status).toBe(202);
    expect((await h.post('send', { to: { kind: 'team', head: 'ceo' }, text: 'Thanks.' })).status).toBe(202);
    expect((await h.post('send', { to: { kind: 'person', id: 'ux-designer' }, text: 'Lunch?' })).status).toBe(202);
    expect(steeredBy(h)[0]).toEqual(['send', STAKEHOLDER, { to: { kind: 'room', id: 'design' }, text: 'The palette goes darker.', for: ['ui-designer'] }]);
  });

  it('passes typed on only for words the person typed, and refuses a typed that is not true or false', async () => {
    const h = await hub({ steering: true });
    expect((await h.post('send', { to: { kind: 'person', id: 'ceo' }, text: 'Approve the plan.', typed: true })).status).toBe(202);
    expect(steeredBy(h).at(-1)).toEqual(['send', STAKEHOLDER, { to: { kind: 'person', id: 'ceo' }, text: 'Approve the plan.', for: [], typed: true }]);
    expect((await h.post('send', { to: { kind: 'person', id: 'ceo' }, text: 'Please propose a plan.', typed: false })).status).toBe(202);
    expect(steeredBy(h).at(-1)).toEqual(['send', STAKEHOLDER, { to: { kind: 'person', id: 'ceo' }, text: 'Please propose a plan.', for: [] }]);
    expect(await h.post('send', { to: { kind: 'everyone' }, text: 'Hi.', typed: 'yes' })).toMatchObject({ status: 400, json: { error: 'typed must be true or false.' } });
  });

  it('refuses a recipient of another shape, an empty message and a "for" that names no one', async () => {
    const h = await hub({ steering: true });
    expect(await h.post('send', { to: { kind: 'crowd' }, text: 'Hi.' })).toMatchObject({ status: 400, json: { error: 'kind must be "person" or "room" or "team" or "everyone".' } });
    expect(await h.post('send', { to: { kind: 'team', id: 'ceo' }, text: 'Hi.' })).toMatchObject({ status: 400, json: { error: 'This takes kind, head, not id.' } });
    expect(await h.post('send', { to: { kind: 'person', id: '../x' }, text: 'Hi.' })).toMatchObject({ status: 400, json: { error: "id isn't an id this office made." } });
    expect(await h.post('send', { to: { kind: 'everyone' }, text: '  ' })).toMatchObject({ status: 400, json: { error: 'text is empty.' } });
    expect(await h.post('send', { to: { kind: 'everyone' }, text: 'Hi.', for: ['kai', 'kai'] })).toMatchObject({ status: 400, json: { error: 'for names one of them twice.' } });
    expect(await h.post('send', { to: 'everyone', text: 'Hi.' })).toMatchObject({ status: 400, json: { error: 'Send a JSON object.' } });
    expect(h.steering.steered).toEqual([]);
  });

  it('reminds or escalates a message for a person', async () => {
    const h = await hub({ steering: true });
    expect(await h.post('messages/m-7/remind', { person: 'ux-designer' })).toMatchObject({ status: 202, json: { id: 'm-1' } });
    expect((await h.post('messages/m-7/escalate', { person: 'ux-designer' })).status).toBe(202);
    expect(steeredBy(h)).toEqual([
      ['remind', STAKEHOLDER, { message: 'm-7', person: 'ux-designer' }],
      ['escalate', STAKEHOLDER, { message: 'm-7', person: 'ux-designer' }],
    ]);
    expect(await h.post('messages/..%2F..%2Fx/remind', { person: 'ux-designer' })).toMatchObject({ status: 404, json: { error: 'No such message.' } });
    expect((await h.post('messages/m-7/shout', { person: 'ux-designer' })).status).toBe(404);
  });
});

describe('the task board', () => {
  it("creates the stakeholder's own task", async () => {
    const h = await hub({ steering: true });
    const made = await h.post('tasks', { title: 'Add loyalty stamps', brief: 'A stamp per pickup.', files: ['web/src/stamps/', './web/src/stamps/'], owner: 'ui-designer', doneWhen: 'The tenth coffee is free.', milestone: null });
    expect(made).toMatchObject({ status: 201, json: { id: 't-3', askedBy: STAKEHOLDER, owner: 'ui-designer', files: ['web/src/stamps/'] } });
    expect(steeredBy(h)[0]?.[2]).toEqual({ title: 'Add loyalty stamps', brief: 'A stamp per pickup.', files: ['web/src/stamps/'], owner: 'ui-designer', doneWhen: 'The tenth coffee is free.', milestone: null, cites: [] });
  });

  it('refuses a task with no title, files outside the project, or too many', async () => {
    const h = await hub({ steering: true });
    const base = { title: 'Stamps', brief: '', files: [], owner: 'ui-designer', doneWhen: '' };
    expect(await h.post('tasks', { ...base, title: ' ' })).toMatchObject({ status: 400, json: { error: 'title is empty.' } });
    expect(await h.post('tasks', { ...base, files: ['../secrets'] })).toMatchObject({ status: 400, json: { error: 'files[0] must be a path inside the project, like "src/menu/".' } });
    expect(await h.post('tasks', { ...base, files: ['C:\\Users\\jamie\\.ssh'] })).toMatchObject({ status: 400, json: { error: 'files[0] must be a path inside the project, like "src/menu/".' } });
    expect(await h.post('tasks', { ...base, files: Array.from({ length: 51 }, (_, i) => `f${i}`) })).toMatchObject({ status: 400, json: { error: 'files holds up to 50 entries.' } });
    expect(await h.post('tasks', { ...base, owner: 'Kai Lee' })).toMatchObject({ status: 400, json: { error: "owner isn't an id this office made." } });
    expect(h.steering.steered).toEqual([]);
  });

  it('orders the tasks, and refuses an order that names one twice', async () => {
    const h = await hub({ steering: true });
    const order = await h.post('tasks/order', { tasks: ['t-2', 't-1'] });
    expect(order.status).toBe(200);
    expect(order.json).toMatchObject([{ id: 't-2', priority: 0 }, { id: 't-1', priority: 1 }]);
    expect(await h.post('tasks/order', { tasks: ['t-1', 't-1'] })).toMatchObject({ status: 400, json: { error: 'tasks names one of them twice.' } });
    expect(await h.post('tasks/order', { tasks: [] })).toMatchObject({ status: 400, json: { error: 'tasks holds 1 to 500 ids.' } });
  });

  it('pauses, resumes, cancels with a reason and reassigns with a note', async () => {
    const h = await hub({ steering: true });
    expect(await h.post('tasks/t-1/pause', {})).toMatchObject({ status: 200, json: { id: 't-1', paused: { by: STAKEHOLDER } } });
    expect(await h.post('tasks/t-1/resume', {})).toMatchObject({ status: 200, json: { id: 't-1', paused: null } });
    expect(await h.post('tasks/t-1/cancel', { reason: 'The flow is in the plan now.' })).toMatchObject({ status: 200, json: { status: 'dropped', cancel: { reason: 'The flow is in the plan now.', branch: 'worklings/cancelled/t-1' } } });
    expect(await h.post('tasks/t-2/reassign', { to: 'ux-designer', note: '' })).toMatchObject({ status: 200, json: { owner: 'ux-designer' } });
    expect(steeredBy(h).map((c) => c[2])).toEqual([
      { action: 'pause', task: 't-1', cites: [] },
      { action: 'resume', task: 't-1', cites: [] },
      { action: 'cancel', task: 't-1', reason: 'The flow is in the plan now.', cites: [] },
      { action: 'reassign', task: 't-2', to: 'ux-designer', note: '', cites: [] },
    ]);
  });

  it('needs a reason to cancel, nothing to pause, and a task id it can read', async () => {
    const h = await hub({ steering: true });
    expect(await h.post('tasks/t-1/cancel', {})).toMatchObject({ status: 400, json: { error: 'Send reason as text.' } });
    expect(await h.post('tasks/t-1/cancel', { reason: 'r'.repeat(DECISION_LIMITS.note + 1) })).toMatchObject({ status: 400, json: { error: 'reason is longer than 1,000 characters.' } });
    expect(await h.post('tasks/t-1/pause', { now: true })).toMatchObject({ status: 400, json: { error: 'This takes an empty object, not now.' } });
    expect(await h.post('tasks/t-1/reassign', { note: 'Take it.' })).toMatchObject({ status: 400, json: { error: "to isn't an id this office made." } });
    expect(await h.post('tasks/%E0%A4%A/pause', {})).toMatchObject({ status: 404, json: { error: 'No such task.' } });
    expect(h.steering.steered).toEqual([]);
  });

  it("pauses and resumes every open task of a room's people", async () => {
    const h = await hub({ steering: true });
    const paused = await h.post('rooms/design/pause', {});
    expect(paused.status).toBe(200);
    expect(paused.json).toMatchObject([{ id: 't-1', paused: { by: STAKEHOLDER } }, { id: 't-2', paused: { by: STAKEHOLDER } }]);
    expect((await h.post('rooms/design/resume', {})).status).toBe(200);
    expect(steeredBy(h).map((c) => c[2])).toEqual([
      { action: 'pause-room', room: 'design', cites: [] },
      { action: 'resume-room', room: 'design', cites: [] },
    ]);
  });
});

describe('the decision log', () => {
  it('undoes a decision, and answers 409 for one that can no longer be undone', async () => {
    const h = await hub({ steering: true });
    expect(await h.post('decisions/d-4/undo', {})).toMatchObject({ status: 200, json: { kind: 'undo', what: 'Undid d-4.' } });
    expect(await h.post('decisions/d-final/undo', {})).toMatchObject({ status: 409, json: { error: "That decision can't be undone any more.", code: 'conflict' } });
  });

  it('sends a decision back to whoever made it with a note', async () => {
    const h = await hub({ steering: true });
    expect(await h.post('decisions/d-4/reconsider', { note: 'Think about slower days.' })).toMatchObject({ status: 202, json: { id: 'm-1' } });
    expect(steeredBy(h)).toEqual([['reconsider', STAKEHOLDER, { decision: 'd-4', note: 'Think about slower days.' }]]);
    expect(await h.post('decisions/d-4/reconsider', {})).toMatchObject({ status: 400, json: { error: 'Send note as text.' } });
  });
});

describe('settings', () => {
  it("changes a setting and answers with the company's settings and steering's", async () => {
    const h = await hub({ steering: true });
    const changed = await h.post('settings', { planApproval: 'milestones' });
    expect(changed).toMatchObject({ status: 200, json: { maxDesks: 8, alwaysAllow: ['Bash(npm test)'], steering: { planApproval: 'milestones', leash: { people: {}, rooms: {} }, effort: {} } } });
    expect((await h.post('settings', { leash: { person: 'ux-designer', leash: 'trusted' } })).json).toMatchObject({ steering: { leash: { people: { 'ux-designer': 'trusted' } } } });
    expect((await h.post('settings', { effort: { person: 'ux-designer', effort: null } })).status).toBe(200);
    expect((await h.post('settings', { model: { person: 'ux-designer', model: 'claude-sonnet-4-5' } })).status).toBe(200);
    expect((await h.post('settings', { maxDesks: 4, removeRule: 'Bash(npm test)' })).status).toBe(200);
    expect(steeredBy(h).map((c) => c[2])).toEqual([
      { planApproval: 'milestones', cites: [] },
      { leash: { person: 'ux-designer', leash: 'trusted' }, cites: [] },
      { effort: { person: 'ux-designer', effort: null }, cites: [] },
      { model: { person: 'ux-designer', model: 'claude-sonnet-4-5' }, cites: [] },
      { maxDesks: 4, removeRule: 'Bash(npm test)', cites: [] },
    ]);
    // v3's own settings call is the steering one now.
    expect(h.company.calls.filter((c) => c.method === 'updateSettings')).toEqual([]);
  });

  it('refuses an empty change, a leash for nobody or for both, and values out of range', async () => {
    const h = await hub({ steering: true });
    const cases: [unknown, string][] = [
      [{}, 'Send a setting to change.'],
      [{ leash: { leash: 'check' } }, 'Send leash with person or room: whose leash it is.'],
      [{ leash: { person: 'ux-designer', room: 'design', leash: 'check' } }, 'Send leash with person or room: whose leash it is.'],
      [{ leash: { person: 'ux-designer', leash: 'loose' } }, 'leash must be "check" or "default" or "trusted".'],
      [{ effort: { person: 'ux-designer', effort: 'huge' } }, 'effort must be "low" or "medium" or "high" or "xhigh" or "max".'],
      [{ model: { person: 'ux-designer', model: 'gpt 9; rm -rf' } }, 'model must be an alias like "sonnet" or a model id.'],
      [{ maxDesks: 21 }, 'maxDesks must be a whole number from 1 to 20.'],
      [{ idleMs: 1_000 }, 'idleMs must be a whole number from 60,000 to 7,200,000.'],
      [{ planApproval: 'sometimes' }, 'planApproval must be "before-work" or "milestones" or "off".'],
      [{ theme: 'dark' }, 'This takes maxDesks, idleMs, planApproval, leash, effort, model, removeRule, not theme.'],
    ];
    for (const [body, error] of cases) expect(await h.post('settings', body)).toMatchObject({ status: 400, json: { error } });
    expect(h.steering.steered).toEqual([]);
  });
});

describe("the company's refusals and failures", () => {
  it('keep their status and sentence, and an unexpected failure says nothing of itself', async () => {
    const h = await hub({ steering: true });
    h.steering.failSteering(new OrgRefusal('not-allowed', 'Only the CEO talks to the board.'));
    expect(await h.post('tasks/t-1/pause', {})).toMatchObject({ status: 403, json: { error: 'Only the CEO talks to the board.', code: 'not-allowed' } });
    h.steering.failSteering(new Error('disk full at C:\\Users\\jamie\\secret'));
    const failed = await h.post('send', { to: { kind: 'everyone' }, text: 'Hi.' });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.json)).not.toContain('secret');
  });

  it('need the token, like every route of the office', async () => {
    const h = await hub({ steering: true });
    expect((await h.post('tasks/t-1/pause', {}, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect(h.steering.steered).toEqual([]);
  });
});
