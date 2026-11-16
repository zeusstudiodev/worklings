import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoProposal } from '../src/core/demo-company.ts';
import { NOT_KEPT } from '../src/core/message-pages.ts';
import { liveActions, liveHub, OFFLINE_SENTENCE, probeServer, refusal } from '../web/src/company/api.ts';
import { liveSteering } from '../web/src/company/steeringApi.ts';
import { ActionError } from '../web/src/company/types.ts';

interface Call {
  url: string;
  method: string;
  body: unknown;
  auth: string | null;
}

/** A fetch that records each request and answers from `reply`. */
function fakeHub(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const call: Call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null, auth: headers.get('authorization') };
    calls.push(call);
    return reply(call);
  });
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A desk as the hub answers a hand-over with it (DeskView). */
const DESK = { person: 'kai', state: 'away', sessionId: '6f1c2a90-5d3e-4b8a-9c1f-2e7d4a6b8c01', since: 1_793_000_000_000, context: 0.42, problem: null, queue: null };
/** The company's settings as the hub answers a change with them (CompanySettings). */
const SETTINGS = {
  maxDesks: 6, idleMs: 300_000, billing: 'plan', alwaysAllow: ['Bash(npm publish --dry-run)'],
  preset: 'lean', models: { ceo: 'opus', head: 'sonnet', lead: 'sonnet', worker: 'sonnet' }, budget: { company: 40, person: null },
};
/** A page of earlier messages as the hub answers with it (MessagePage): a message passed on, and its acknowledgement. */
const PAGE = {
  messages: [
    {
      id: 'm-200', from: 'ceo', to: 'kai', text: 'Make the palette darker.', origin: '@stakeholder', relayOf: 'm-199', note: 'For the menu.', at: 1_793_000_000_000,
      deliveredAt: 1_793_000_030_000, interrupt: false, audience: null, for: ['kai'], deliveredHow: 'next-step', cites: [],
    },
  ],
  acks: [{ id: 'k-200', message: 'm-200', by: 'kai', agree: true, text: 'Trying espresso brown.', at: 1_793_000_060_000 }],
  more: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a company's actions over the hub's routes", () => {
  it('posts each action to its route with the token, in the body the hub takes', async () => {
    const calls = fakeHub((call) => (/\/(handover|bringback)$/.test(call.url) ? json(200, DESK) : json(200, { ok: true })));
    const actions = liveActions('plant-pal', 'tok');
    await actions.answer('q-1', 0, '');
    await actions.answerWithPicks();
    await actions.decide('a-1', 'deny', false, 'Not on Fridays.');
    await actions.undo('a-1');
    await actions.stop('kai', 'Stop here and wait for my next message.');
    await actions.unsend('m-1');
    await actions.start();
    await actions.pause();
    await actions.resume();
    await actions.handOver('kai');
    await actions.bringBack('kai');
    await actions.markSeen('kai');
    await actions.looked();
    await actions.restoreProposal();
    await actions.removeDashboard('launch-checklist');
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/c/plant-pal/answers', { question: 'q-1', option: 0, text: '' }],
      ['POST', '/api/c/plant-pal/scoping/picks', {}],
      ['POST', '/api/c/plant-pal/approvals', { approval: 'a-1', decision: 'deny', always: false, note: 'Not on Fridays.' }],
      ['POST', '/api/c/plant-pal/undo', { item: 'a-1' }],
      ['POST', '/api/c/plant-pal/stop', { person: 'kai', instruction: 'Stop here and wait for my next message.' }],
      ['POST', '/api/c/plant-pal/unsend', { message: 'm-1' }],
      ['POST', '/api/c/plant-pal/start', {}],
      ['POST', '/api/c/plant-pal/pause', {}],
      ['POST', '/api/c/plant-pal/resume', {}],
      ['POST', '/api/c/plant-pal/handover', { person: 'kai' }],
      ['POST', '/api/c/plant-pal/bringback', { person: 'kai' }],
      ['POST', '/api/c/plant-pal/seen', { person: 'kai' }],
      ['POST', '/api/c/plant-pal/looked', {}],
      ['POST', '/api/c/plant-pal/proposal', { restore: true }],
      ['POST', '/api/c/plant-pal/dashboards/remove', { dashboard: 'launch-checklist' }],
    ]);
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('marks typed words with typed: true, and sends no mark for a button or a plain Stop', async () => {
    const calls = fakeHub(() => json(202, { id: 'm-7' }));
    const actions = liveActions('plant-pal', 'tok');
    await actions.say('ceo', 'Approve the plan.', { typed: true });
    await actions.say('ceo', 'Please propose a plan for my approval.');
    await actions.stop('kai', 'Use the brand colours.', { typed: true });
    await actions.stop('kai', 'Stop here and wait for my next message.', { typed: false });
    await liveSteering('plant-pal', 'tok').send({ kind: 'room', id: 'design' }, 'Darker, please.', [], { typed: true });
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ['/api/c/plant-pal/messages', { to: 'ceo', text: 'Approve the plan.', typed: true }],
      ['/api/c/plant-pal/messages', { to: 'ceo', text: 'Please propose a plan for my approval.' }],
      ['/api/c/plant-pal/stop', { person: 'kai', instruction: 'Use the brand colours.', typed: true }],
      ['/api/c/plant-pal/stop', { person: 'kai', instruction: 'Stop here and wait for my next message.' }],
      ['/api/c/plant-pal/send', { to: { kind: 'room', id: 'design' }, text: 'Darker, please.', for: [], typed: true }],
    ]);
  });

  it("turns the hub's 202 {id} for a message into the message you sent", async () => {
    fakeHub(() => json(202, { id: 'm-7' }));
    const sent = await liveActions('plant-pal', null).say('ceo', 'Merge design and UX.');
    expect(sent).toMatchObject({ id: 'm-7', from: '@stakeholder', to: 'ceo', text: 'Merge design and UX.', deliveredAt: null, note: null });
  });

  it("returns a refused proposal edit's sentences instead of throwing", async () => {
    const errors = ['Design has seven people and no team lead. Add one, move someone, or ask the CEO.'];
    const calls = fakeHub(() => json(400, { ok: false, errors, error: errors[0] }));
    await expect(liveActions('plant-pal', null).editProposal(demoProposal())).resolves.toEqual({ ok: false, errors });
    expect(calls[0]?.body).toEqual({ proposal: demoProposal() });
    fakeHub(() => json(200, { ok: true, proposal: demoProposal() }));
    await expect(liveActions('plant-pal', null).editProposal(demoProposal())).resolves.toEqual({ ok: true });
  });

  it("refuses with the office's own sentence and code", async () => {
    fakeHub(() => json(409, { error: 'It reached Noah already, so it can’t be unsent.', code: 'conflict' }));
    const error = await liveActions('plant-pal', null).unsend('m-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 409, code: 'conflict', message: 'It reached Noah already, so it can’t be unsent.' });
  });

  it("says the office didn't answer when the request never got through", async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(liveActions('plant-pal', null).start()).rejects.toMatchObject({ status: 0, code: 'offline', message: OFFLINE_SENTENCE });
  });

  it('reads a diff as text, and gives screenshots an address that carries the token', async () => {
    fakeHub(() => new Response('diff --git a/x b/x\n', { status: 200 }));
    const actions = liveActions('plant pal', 'tok');
    await expect(actions.taskDiff('t-1')).resolves.toBe('diff --git a/x b/x\n');
    expect(actions.screenshotUrl('shot-1')).toBe('/api/c/plant%20pal/screenshots/shot-1?token=tok');
  });

  it("keeps the preview's address on the tailnet, for a phone that opened the office there", async () => {
    const tailnetUrl = 'https://studio-pc.tail1234.ts.net:8443/';
    fakeHub(() => json(200, { state: 'up', url: 'http://127.0.0.1:5199', tailnetUrl, command: 'npm run dev', problem: null }));
    await expect(liveActions('plant-pal', null).preview('start')).resolves.toMatchObject({ url: 'http://127.0.0.1:5199', tailnetUrl });
  });

  it('takes only the fields it knows from what the hub answers', async () => {
    fakeHub(() => json(200, { state: 'up', url: 'http://127.0.0.1:5199', command: 'npm run dev', problem: null, extra: 'ignored' }));
    await expect(liveActions('plant-pal', null).preview('start')).resolves.toEqual({ state: 'up', url: 'http://127.0.0.1:5199', tailnetUrl: null, command: 'npm run dev', problem: null });
    fakeHub(() => json(200, { ...DESK, extra: 'ignored' }));
    await expect(liveActions('plant-pal', null).handOver('kai')).resolves.toEqual(DESK);
  });

  it.each([
    ['an unknown state', { ...DESK, state: 'somewhere' }],
    ['no time it changed', { ...DESK, since: undefined }],
    ['a session that is a number', { ...DESK, sessionId: 7 }],
    ['nothing', null],
  ])("refuses a desk with %s instead of making one up", async (_, body) => {
    fakeHub(() => json(200, body));
    const actions = liveActions('plant-pal', null);
    for (const press of [() => actions.handOver('kai'), () => actions.bringBack('kai')]) {
      const error = await press().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ActionError);
      expect(error).toMatchObject({ status: 500, code: 'bad-answer', message: "The office did that but didn't say how their desk stands now." });
    }
  });

  it('takes the settings the hub answers with', async () => {
    const calls = fakeHub(() => json(200, SETTINGS));
    await expect(liveActions('plant-pal', 'tok').updateSettings({ maxDesks: 6 })).resolves.toEqual(SETTINGS);
    expect(calls.map((c) => [c.url, c.body])).toEqual([['/api/c/plant-pal/settings', { maxDesks: 6 }]]);
  });

  it.each([
    ['no desks', { ...SETTINGS, maxDesks: undefined }],
    ['no idle time', { ...SETTINGS, idleMs: undefined }],
    ['a billing it does not know', { ...SETTINGS, billing: 'free' }],
    ['rules that are not all words', { ...SETTINGS, alwaysAllow: ['Bash(npm test)', 3] }],
    ['an empty answer', {}],
  ])('refuses settings with %s instead of making them up', async (_, body) => {
    fakeHub(() => json(200, body));
    const error = await liveActions('plant-pal', null).updateSettings({ removeRule: 'Bash(npm publish --dry-run)' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 500, code: 'bad-answer', message: "The office saved it but didn't say what the settings are now." });
  });

  it('takes a change to the studio or the office as the hub answers with it', async () => {
    const result = { ok: false, message: "The CEO can't be fired: the company needs one.", changed: [] };
    fakeHub(() => json(200, result));
    await expect(liveActions('plant-pal', null).reshape({ action: 'fire', role: 'ceo' })).resolves.toEqual(result);
    const moved = { ok: true, message: 'Moved Kai to Design.', changed: ['.claude/studio.yaml'] };
    fakeHub(() => json(200, moved));
    await expect(liveActions('plant-pal', null).changeOffice({ change: 'theme', theme: 'cafe' })).resolves.toEqual(moved);
  });

  it.each([
    ['nothing but ok', { ok: true }],
    ['no list of what changed', { ok: true, message: 'Changed.' }],
    ['a list that is not all words', { ok: true, message: 'Changed.', changed: [3] }],
    ['an empty answer', null],
  ])("refuses a change it can't read, with %s, instead of saying it worked", async (_, body) => {
    fakeHub(() => json(200, body));
    const actions = liveActions('plant-pal', null);
    for (const press of [() => actions.reshape({ action: 'fire', role: 'kai' }), () => actions.changeOffice({ change: 'theme', theme: 'cafe' })]) {
      const error = await press().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ActionError);
      expect(error).toMatchObject({ status: 500, code: 'bad-answer', message: "The office took it but didn't say how it went." });
    }
  });

  it('asks for earlier messages with a GET and the token as a bearer, and reads the page the hub sends', async () => {
    const calls = fakeHub(() => json(200, PAGE));
    const actions = liveActions('plant pal', 'tok');
    await expect(actions.earlierMessages('m-201', 50)).resolves.toEqual(PAGE);
    await expect(actions.earlierMessages('m-201')).resolves.toEqual(PAGE);
    expect(calls.map((c) => [c.method, c.url, c.body, c.auth])).toEqual([
      ['GET', '/api/c/plant%20pal/messages?before=m-201&limit=50', null, 'Bearer tok'],
      ['GET', '/api/c/plant%20pal/messages?before=m-201', null, 'Bearer tok'],
    ]);
  });

  it.each([
    ['no word on whether more remain', { messages: PAGE.messages, acks: PAGE.acks }],
    ['messages that are not a list', { ...PAGE, messages: 'm-200' }],
    ['a message without words', { ...PAGE, messages: [{ ...PAGE.messages[0], text: undefined }] }],
    ['a message without a time', { ...PAGE, messages: [{ ...PAGE.messages[0], at: '14:02' }] }],
    ['an acknowledgement that neither agrees nor disagrees', { ...PAGE, acks: [{ ...PAGE.acks[0], agree: 'maybe' }] }],
    ['nothing', null],
  ])("refuses a page with %s instead of taking it as the end of the history", async (_, body) => {
    fakeHub(() => json(200, body));
    const error = await liveActions('plant-pal', null).earlierMessages('m-201').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 500, code: 'bad-answer', message: "The office sent earlier messages this page can't read. Try again." });
  });

  it("passes on the office's sentence for a message it doesn't keep", async () => {
    fakeHub(() => json(400, { error: NOT_KEPT, code: 'unknown' }));
    await expect(liveActions('plant-pal', null).earlierMessages('m-1')).rejects.toMatchObject({ status: 400, code: 'unknown', message: NOT_KEPT });
  });
});

describe("the hub's own actions", () => {
  it('starts, removes and reopens companies and sets the desks across them', async () => {
    const calls = fakeHub((call) => (call.url === '/api/companies' ? json(201, { id: 'plant-pal', reopened: false }) : json(200, { ok: true })));
    const hub = liveHub('tok');
    await expect(hub.createCompany('C:\\Users\\you\\plant-pal', 'Plants.')).resolves.toEqual({ id: 'plant-pal' });
    await hub.removeCompany('plant-pal');
    await hub.reopenCompany('C:\\Users\\you\\plant-pal');
    await hub.setHubDesks(12);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      // The start form says how the work runs: one Claude Code session unless it chose the team.
      ['POST', '/api/companies', { folder: 'C:\\Users\\you\\plant-pal', prompt: 'Plants.', work: 'plain' }],
      ['DELETE', '/api/companies/plant-pal', null],
      ['POST', '/api/companies', { folder: 'C:\\Users\\you\\plant-pal' }],
      ['POST', '/api/hub/settings', { maxDesks: 12 }],
    ]);
  });

  it("reads the folder browser's listing, and the path of a new folder", async () => {
    const listing = { path: 'C:\\Users\\you', parent: 'C:\\Users', folders: ['Projects'], detected: 'A folder with no app Worklings recognises.', notes: ['Not a git repository.'] };
    const calls = fakeHub((call) => (call.method === 'POST' ? json(201, { path: 'C:\\Users\\you\\fresh' }) : json(200, listing)));
    const hub = liveHub(null);
    await expect(hub.folders('C:\\Users\\you')).resolves.toEqual({ ...listing, refusal: null });
    await expect(hub.newFolder('C:\\Users\\you', 'fresh')).resolves.toBe('C:\\Users\\you\\fresh');
    expect(calls.map((c) => c.url)).toEqual(['/api/folders?path=C%3A%5CUsers%5Cyou', '/api/folders']);
  });

  it('marks the folder the person chose, which the hub reads with git, and no level of the browser', async () => {
    const calls = fakeHub(() => json(200, { path: 'C:\\Users\\you\\plant pal', parent: 'C:\\Users\\you', folders: [], detected: null, notes: [] }));
    const hub = liveHub(null);
    await hub.folders('C:\\Users\\you\\plant pal', { chosen: true });
    await hub.folders('C:\\Users\\you\\plant pal');
    await hub.folders('', { chosen: false });
    const asked = calls.map((c) => new URL(c.url, 'http://hub.test'));
    expect(asked.map((u) => [u.pathname, u.searchParams.get('path'), u.searchParams.get('chosen')])).toEqual([
      ['/api/folders', 'C:\\Users\\you\\plant pal', '1'],
      ['/api/folders', 'C:\\Users\\you\\plant pal', null],
      ['/api/folders', null, null],
    ]);
  });
});

describe('which server answered', () => {
  it('knows the hub by its lobby stream, and v2 by the page it serves instead', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    await expect(probeServer('tok')).resolves.toBe('hub');
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(probeServer('tok')).resolves.toBe('office');
    vi.stubGlobal('fetch', async () => json(401, { error: 'Open the hub with the link the CLI printed.' }));
    await expect(probeServer(null)).resolves.toBe('hub');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(probeServer(null)).resolves.toBe('unreachable');
  });

  it('keeps a refusal with no sentence readable', () => {
    expect(refusal(500, null).message).toBe('The office turned that down (500). Try again.');
    expect(refusal(401, null)).toMatchObject({ code: 'locked', message: 'Open the office from the link the CLI printed. It carries the access token.' });
  });
});
