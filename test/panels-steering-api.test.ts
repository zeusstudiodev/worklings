import { afterEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_SENTENCE } from '../web/src/company/api.ts';
import { liveSteering } from '../web/src/company/steeringApi.ts';
import { ActionError } from '../web/src/company/types.ts';

interface Call {
  url: string;
  method: string;
  body: unknown;
  auth: string | null;
  type: string | null;
}

/** A fetch that records each request and answers from `reply`. */
function fakeHub(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      auth: headers.get('authorization'),
      type: headers.get('content-type'),
    };
    calls.push(call);
    return reply(call);
  });
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A task as the hub answers a create with it. */
const TASK = {
  id: 't-40', title: 'Holiday opening hours', brief: 'Add the holidays.', owner: 'backend-engineer', askedBy: '@stakeholder', files: ['src/data/hours.ts'],
  doneWhen: 'Slots skip the holidays.', status: 'queued', outcome: null, parent: null, milestone: 'ms-pickup', worktree: null, commit: null,
  createdAt: 1_793_000_000_000, updatedAt: 1_793_000_000_000, priority: 4,
};

const SETTINGS = { planApproval: 'milestones', leash: { people: { 'ui-designer': 'check' }, rooms: { engineering: 'trusted' } }, effort: { 'frontend-engineer': 'high' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("steering's actions over the hub's routes", () => {
  it('posts each action to its route with the token, in the body the hub takes', async () => {
    const calls = fakeHub((call) => (call.url.endsWith('/send') ? json(202, { ids: ['m-1'] }) : call.url.endsWith('/tasks') ? json(201, TASK) : call.url.endsWith('/settings') ? json(200, SETTINGS) : json(200, {})));
    const steer = liveSteering('cafe-lumen', 'tok');
    await steer.approvePlan(3, 'ms-pickup');
    await steer.commentPlan({ kind: 'task', id: 'p-7' }, 'Do this after the cart.');
    await steer.send({ kind: 'room', id: 'design' }, 'Darker, please.', ['ui-designer']);
    await steer.remind('m-12', 'head-of-design');
    await steer.escalate('m-12', 'head-of-design');
    await steer.orderTasks(['t-2', 't-1']);
    await steer.pauseTask('t-1');
    await steer.resumeTask('t-1');
    await steer.pauseRoom('design');
    await steer.resumeRoom('design');
    await steer.cancelTask('t-1', 'Cards wait for launch.');
    await steer.reassignTask('t-1', 'frontend-engineer', 'Mina started the colours.');
    await steer.createTask({ title: 'Holiday opening hours', brief: 'Add the holidays.', files: ['src/data/hours.ts'], owner: 'backend-engineer', doneWhen: 'Slots skip the holidays.', milestone: 'ms-pickup' });
    await steer.undoDecision('d-4');
    await steer.reconsider('d-4', 'Charcoal reads better at night.');
    await steer.changeSettings({ leash: { person: 'ui-designer', leash: 'check' } });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/c/cafe-lumen/plan/approve', { version: 3, through: 'ms-pickup' }],
      ['POST', '/api/c/cafe-lumen/plan/comment', { on: { kind: 'task', id: 'p-7' }, text: 'Do this after the cart.' }],
      ['POST', '/api/c/cafe-lumen/send', { to: { kind: 'room', id: 'design' }, text: 'Darker, please.', for: ['ui-designer'] }],
      ['POST', '/api/c/cafe-lumen/messages/m-12/remind', { person: 'head-of-design' }],
      ['POST', '/api/c/cafe-lumen/messages/m-12/escalate', { person: 'head-of-design' }],
      ['POST', '/api/c/cafe-lumen/tasks/order', { tasks: ['t-2', 't-1'] }],
      ['POST', '/api/c/cafe-lumen/tasks/t-1/pause', {}],
      ['POST', '/api/c/cafe-lumen/tasks/t-1/resume', {}],
      ['POST', '/api/c/cafe-lumen/rooms/design/pause', {}],
      ['POST', '/api/c/cafe-lumen/rooms/design/resume', {}],
      ['POST', '/api/c/cafe-lumen/tasks/t-1/cancel', { reason: 'Cards wait for launch.' }],
      ['POST', '/api/c/cafe-lumen/tasks/t-1/reassign', { to: 'frontend-engineer', note: 'Mina started the colours.' }],
      ['POST', '/api/c/cafe-lumen/tasks', { title: 'Holiday opening hours', brief: 'Add the holidays.', files: ['src/data/hours.ts'], owner: 'backend-engineer', doneWhen: 'Slots skip the holidays.', milestone: 'ms-pickup' }],
      ['POST', '/api/c/cafe-lumen/decisions/d-4/undo', {}],
      ['POST', '/api/c/cafe-lumen/decisions/d-4/reconsider', { note: 'Charcoal reads better at night.' }],
      ['POST', '/api/c/cafe-lumen/settings', { leash: { person: 'ui-designer', leash: 'check' } }],
    ]);
    expect(calls.every((c) => c.auth === 'Bearer tok' && c.type === 'application/json')).toBe(true);
  });

  it('keeps ids with slashes and spaces inside their part of the path', async () => {
    const calls = fakeHub(() => json(200, {}));
    const steer = liveSteering('plant pal', null);
    await steer.pauseTask('t/1');
    await steer.remind('m 12', 'kai');
    expect(calls.map((c) => c.url)).toEqual(['/api/c/plant%20pal/tasks/t%2F1/pause', '/api/c/plant%20pal/messages/m%2012/remind']);
    expect(calls.every((c) => c.auth === null)).toBe(true);
  });

  it("refuses with the office's own sentence and code", async () => {
    fakeHub(() => json(409, { error: 'Version 4 is the latest now. Read it before approving.', code: 'conflict' }));
    const error = await liveSteering('cafe-lumen', null).approvePlan(3, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 409, code: 'conflict', message: 'Version 4 is the latest now. Read it before approving.' });
  });

  it("says the office didn't answer when the request never got through", async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(liveSteering('cafe-lumen', null).undoDecision('d-1')).rejects.toMatchObject({ status: 0, code: 'offline', message: OFFLINE_SENTENCE });
  });
});

describe('sending to anyone', () => {
  it("gives the copies the hub answers with, who each went to and all", async () => {
    const copies = [
      { id: 'm-20', from: '@stakeholder', to: 'head-of-design', text: 'Darker.', at: 5, origin: null, relayOf: null, note: null, deliveredAt: null, interrupt: false, for: ['ui-designer'] },
      { id: 'm-21', from: '@stakeholder', to: 'ui-designer', text: 'Darker.', at: 5 },
      { id: 'broken' },
    ];
    fakeHub(() => json(202, { ids: ['m-20', 'm-21'], messages: copies }));
    const sent = await liveSteering('cafe-lumen', null).send({ kind: 'room', id: 'design' }, 'Darker.', ['ui-designer']);
    expect(sent.map((m) => [m.id, m.to, m.for ?? null])).toEqual([
      ['m-20', 'head-of-design', ['ui-designer']],
      ['m-21', 'ui-designer', null],
    ]);
  });

  it('makes the message you sent from the ids alone, naming the person when it went to one', async () => {
    fakeHub(() => json(202, { ids: ['m-7'] }));
    const [sent] = await liveSteering('cafe-lumen', null).send({ kind: 'person', id: 'ceo' }, 'Revise it.', []);
    expect(sent).toMatchObject({ id: 'm-7', from: '@stakeholder', to: 'ceo', text: 'Revise it.', deliveredAt: null, interrupt: false, for: [] });
    fakeHub(() => json(202, { ids: ['m-8', 'm-9'] }));
    const room = await liveSteering('cafe-lumen', null).send({ kind: 'everyone' }, 'Launch is Monday.', []);
    expect(room.map((m) => [m.id, m.to])).toEqual([
      ['m-8', ''],
      ['m-9', ''],
    ]);
  });

  it("refuses an answer that doesn't say which message it made", async () => {
    fakeHub(() => json(202, {}));
    await expect(liveSteering('cafe-lumen', null).send({ kind: 'everyone' }, 'Hi.', [])).rejects.toMatchObject({ status: 500, code: 'bad-answer' });
  });
});

describe('the plan, tasks and settings', () => {
  it("returns a refused plan edit's sentences instead of throwing", async () => {
    const errors = ['Task “Cart” waits for a task the plan no longer has.'];
    const calls = fakeHub(() => json(400, { ok: false, errors }));
    const plan = { goal: 'Pickup orders work', milestones: [], tasks: [] };
    await expect(liveSteering('cafe-lumen', null).editPlan(plan, 'Cut the cart.')).resolves.toEqual({ ok: false, errors });
    expect(calls[0]?.body).toEqual({ plan, note: 'Cut the cart.' });
    fakeHub(() => json(200, { ok: true, version: { version: 5 } }));
    await expect(liveSteering('cafe-lumen', null).editPlan(plan, null)).resolves.toEqual({ ok: true });
    fakeHub(() => json(403, { error: 'Only the stakeholder edits the plan here.' }));
    await expect(liveSteering('cafe-lumen', null).editPlan(plan, null)).rejects.toMatchObject({ status: 403, message: 'Only the stakeholder edits the plan here.' });
  });

  it('takes the task the hub made, and only the fields it knows', async () => {
    fakeHub(() => json(201, { ...TASK, extra: 'ignored', cites: ['m-3'] }));
    const input = { title: TASK.title, brief: TASK.brief, files: TASK.files, owner: TASK.owner, doneWhen: TASK.doneWhen, milestone: TASK.milestone };
    await expect(liveSteering('cafe-lumen', null).createTask(input)).resolves.toEqual({ ...TASK, cites: ['m-3'] });
  });

  it.each([
    ['an unknown status', { ...TASK, status: 'somewhere' }],
    ['no owner', { ...TASK, owner: undefined }],
    ['files that are not a list', { ...TASK, files: 'src/' }],
    ['nothing', null],
  ])('refuses a made task with %s instead of making one up', async (_, body) => {
    fakeHub(() => json(201, body));
    const error = await liveSteering('cafe-lumen', null)
      .createTask({ title: 'x', brief: 'x', files: [], owner: 'kai', doneWhen: 'x', milestone: null })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: 'bad-answer', message: "The office made the task but didn't say what it is. It shows on Tasks." });
  });

  it("takes steering's settings beside v3's or nested under steering", async () => {
    fakeHub(() => json(200, { maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [], ...SETTINGS }));
    await expect(liveSteering('cafe-lumen', null).changeSettings({ effort: { person: 'frontend-engineer', effort: 'high' } })).resolves.toEqual(SETTINGS);
    fakeHub(() => json(200, { maxDesks: 8, steering: SETTINGS }));
    await expect(liveSteering('cafe-lumen', null).changeSettings({ planApproval: 'milestones' })).resolves.toEqual(SETTINGS);
  });

  it('keeps an id like __proto__ as data, never as a prototype', async () => {
    fakeHub(() => new Response(`{"planApproval":"off","leash":{"people":{"__proto__":"trusted"},"rooms":{}},"effort":{}}`, { status: 200 }));
    const settings = await liveSteering('cafe-lumen', null).changeSettings({ planApproval: 'off' });
    expect(Object.getPrototypeOf(settings.leash.people)).toBeNull();
    expect(Object.hasOwn(settings.leash.people, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).trusted).toBeUndefined();
  });

  it.each([
    ['an unknown leash', { ...SETTINGS, leash: { people: { kai: 'on a long rope' }, rooms: {} } }],
    ['an unknown effort', { ...SETTINGS, effort: { kai: 'ultra' } }],
    ['no plan approval', { leash: SETTINGS.leash, effort: {} }],
    ['nothing', null],
  ])('refuses settings with %s', async (_, body) => {
    fakeHub(() => json(200, body));
    await expect(liveSteering('cafe-lumen', null).changeSettings({ planApproval: 'off' })).rejects.toMatchObject({
      status: 500,
      code: 'bad-answer',
      message: "The office saved it but didn't say what the settings are now.",
    });
  });
});
