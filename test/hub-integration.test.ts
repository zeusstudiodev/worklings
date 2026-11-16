// The hub with every real part (the company, the org flow, the switchboard, the org tools, the previews) and only
// Claude Code faked: test/fake-desk.mjs, scripted by the "[fake:<scenario>]" each turn's message carries. It goes over
// HTTP and SSE as the browser does, from the first prompt to a restart. The steps share one company and build on each
// other, so they run in order; every wait is sized for desks starting on a loaded machine, and nothing is retried.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import type { CompanyView, LobbyView, Message } from '../src/core/company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import { transcriptDir } from '../src/server/replay.ts';
import { tempDir } from './library-kit.ts';
import { alive, FAKE_DESK, type FakeLogEntry } from './runtime-kit.ts';

const TOKEN = 'integration-token-0123456789abcdefghijkl';
const ID = 'plant-pal';
/** When the scripted usage limit resets: two hours on, in seconds as Claude Code's rate_limit_event gives it. */
const RESETS_AT_S = Math.ceil(Date.now() / 1000) + 2 * 3600;
/** A wait long enough for a desk to start on a busy machine. */
const SLOW = { timeout: 60_000, interval: 50 };
const STEP_MS = 120_000;

const member = (id: string, name: string, title: string, level: string, room: string, reportsTo: string | null, model: string, owns: string, library: string) => ({
  id, name, title, level, room, reportsTo, model, owns, library,
});

/** A large org the CEO proposes under the default Balanced preset: nine people in three rooms, two heads who brief three each and a product manager. */
const PROPOSAL = {
  company: 'Plant Pal',
  goal: 'A plant care app that reminds people to water their plants and keeps a streak.',
  size: 'large',
  sizing: 'An app with a design side and an engineering side, each with three people and a head, and a product manager.',
  theme: 'garden',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'design', title: 'Design', style: 'design' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  people: [
    member('ceo', 'Noor', 'CEO', 'ceo', 'direction', null, 'opus', 'The company, its goal and the line to the stakeholder', 'ceo'),
    member('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', 'sonnet', 'The look and the flows of the app', 'head'),
    member('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The watering flow and its reminders', 'ux-designer'),
    member('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design', 'sonnet', 'The palette, type and the streak card', 'ui-designer'),
    member('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo', 'sonnet', 'The app, its data and its releases', 'head'),
    member('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'The screens and the reminders', 'frontend-engineer'),
    member('backend-engineer', 'Ivo', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering', 'sonnet', 'The plant data, streaks and sync', 'backend-engineer'),
    member('devops-engineer', 'Rui', 'DevOps engineer', 'worker', 'engineering', 'head-of-engineering', 'haiku', 'Hosting, builds and deploys of the app', 'devops-engineer'),
    member('art-director', 'Nia', 'Art director', 'worker', 'design', 'head-of-design', 'haiku', 'The plant drawings and the look they share', 'art-director'),
    member('product-manager', 'Mira', 'Product manager', 'worker', 'direction', 'ceo', 'sonnet', 'The stories for watering and what the first release holds', 'product-manager'),
  ],
  questions: [],
};

/** What each desk's turn does, by the scenario its message names; anything else just answers. */
const SCRIPT = {
  default: [{ say: 'On it.' }],
  scenarios: {
    found: [{ org: 'library_catalogue', arguments: {} }, { org: 'propose_org', arguments: PROPOSAL }, { say: 'I proposed an org of nine for Plant Pal.' }],
    busy: [{ wait: 8_000 }, { say: 'Started on the palette.' }],
    slow: [{ wait: 20_000 }, { say: 'Sketched the watering flow.' }],
    relay: [{ org: 'relay', arguments: { to: ['ui-designer'], note: 'Menu pages first.' } }, { say: 'Passed it on to Kai.' }],
    push: [{ tool: 'Bash', input: { command: 'git push origin HEAD', description: 'Push the work branch' }, ask: true }, { say: 'Pushed the branch.' }],
    long: [{ wait: 120_000 }, { say: 'Built the menu page.' }],
    server: [{ orphan: true, lingerMs: 6_000 }, { wait: 120_000 }],
    limit: [{ limit: { status: 'rejected', resetsAt: RESETS_AT_S, rateLimitType: 'five_hour', utilization: 1 } }, { fail: 'usage-limit' }],
    // v0.2: the report as a fixed form, and in its old free-text form, both through the real org tools.
    'report-form': [
      { org: 'report', arguments: { task: 't-1', state: 'done', files: ['docs/stories.md'], check: { ran: 'node --test', passed: true }, open: [], note: 'Stories done.' } },
      { say: 'Reported.' },
    ],
    'report-old': [{ org: 'report', arguments: { task: 't-2', outcome: 'done', summary: 'Drawings sketched.' } }, { say: 'Reported.' }],
  },
  byText: [
    { includes: 'New task t-1,', scenario: 'report-form' },
    { includes: 'New task t-2,', scenario: 'report-old' },
  ],
};

interface World {
  home: string;
  project: string;
  logFile: string;
  env: NodeJS.ProcessEnv;
  claude: string;
  scratch: string;
  hub: RunningHub;
}

let w: World;

async function open(world: Omit<World, 'hub'>): Promise<RunningHub> {
  return startHub({
    port: 0, token: TOKEN, webDir: null, library: loadLibrary(), home: world.home, env: world.env, claudeHome: world.claude, tickMs: 25,
    desks: { scratch: world.scratch }, aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') },
  });
}

const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const res = await fetch(`${w.hub.url}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> };
};

async function company(): Promise<CompanyView> {
  const snapshot = (await call(`api/c/${ID}/state`)).body as unknown as Snapshot;
  if (!snapshot.company) throw new Error('the snapshot has no company');
  return snapshot.company;
}

const messageOf = (view: CompanyView, id: string): Message | undefined => view.messages.find((m) => m.id === id);
const say = async (to: string, text: string): Promise<string> => {
  const sent = await call(`api/c/${ID}/messages`, { body: { to, text } });
  expect(sent.status).toBe(202);
  return String(sent.body.id);
};
const sessionOf = async (person: string): Promise<string> => {
  const session = (await company()).people.find((p) => p.id === person)?.desk.sessionId;
  if (!session) throw new Error(`${person} has no session yet`);
  return session;
};

function log(): FakeLogEntry[] {
  try {
    return readFileSync(w.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry);
  } catch {
    return [];
  }
}

/** The processes that ran a session: the fake's start lines name it with --session-id or --resume. */
const pidsOf = (sessionId: string) => new Set(log().filter((e) => e.event === 'start' && e.argv?.includes(sessionId)).map((e) => e.pid));
const textOf = (e: FakeLogEntry): string => {
  const content = (e.line?.message as { content?: unknown } | undefined)?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? '').join('') : '';
};
/** What a session's desks were sent, in order. */
const sentTo = (sessionId: string): string[] => {
  const pids = pidsOf(sessionId);
  return log().filter((e) => e.event === 'line' && pids.has(e.pid) && e.line?.type === 'user').map(textOf);
};

/** Follows a stream as the browser does, returning each event with when it arrived. */
async function follow(path: string) {
  const controller = new AbortController();
  const res = await fetch(`${w.hub.url}${path}?token=${TOKEN}`, { signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async <T>(event: string, test: (data: T) => boolean, ms = SLOW.timeout): Promise<{ data: T; at: number }> => {
    const end = Date.now() + ms;
    for (;;) {
      for (let cut = buffer.indexOf('\n\n'); cut !== -1; cut = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (name === event && data) {
          const value = JSON.parse(data) as T;
          if (test(value)) return { data: value, at: Date.now() };
        }
      }
      if (Date.now() > end) throw new Error(`no ${event} on ${path} within ${ms} ms`);
      const timer = new Promise<null>((done) => setTimeout(() => done(null), Math.max(0, end - Date.now())));
      const read = await Promise.race([reader.read(), timer]);
      if (read === null) continue;
      if (read.done) throw new Error(`the stream ${path} ended`);
      buffer += decoder.decode(read.value);
    }
  };
  return { next, close: () => controller.abort() };
}

beforeAll(async () => {
  const dir = tempDir('worklings-integration-');
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
  // The company's own git reads the process's environment: give it this config and none of the machine's.
  vi.stubEnv('GIT_CONFIG_GLOBAL', gitconfig);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  // The hub runs in this process: it looks for what a desk starts in the background more often than it would.
  vi.stubEnv('WORKLINGS_PROCESS_POLL_MS', '200');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(SCRIPT));
  const sessions = join(dir, 'sessions');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN'].includes(name.toUpperCase()));
  const world = {
    home: join(dir, 'home'),
    project: join(dir, 'projects', 'plant-pal'),
    logFile: join(dir, 'desk.jsonl'),
    claude: join(dir, 'claude'),
    scratch,
    env: {
      ...Object.fromEntries(kept), WORKLINGS_CLAUDE: FAKE_DESK, FAKE_DESK_SCRIPT: scriptFile, FAKE_DESK_LOG: join(dir, 'desk.jsonl'), FAKE_DESK_SESSIONS: sessions,
      GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
    },
  };
  mkdirSync(join(dir, 'projects'));
  mkdirSync(world.home);
  w = { ...world, hub: await open(world) };
}, STEP_MS);

afterAll(async () => {
  await w?.hub.close();
  vi.unstubAllEnvs();
}, STEP_MS);

// Tests in a file run one after another, in this order: each step starts from where the one before left the company.
describe('a company end to end, with only Claude Code faked', () => {
  it('creates a company from a prompt, and its CEO opens with the first turn', { timeout: STEP_MS }, async () => {
    const created = await call('api/companies', { body: { folder: w.project, prompt: 'A plant care app with watering streaks [fake:found]' } });
    expect([created.status, created.body]).toEqual([201, { id: ID, reopened: false }]);
    expect((await call('api/lobby')).body as unknown as LobbyView).toMatchObject({ companies: [{ id: ID, phase: 'founding' }] });
    await vi.waitFor(async () => expect((await company()).people.find((p) => p.id === 'ceo')?.desk.sessionId).toBeTruthy(), SLOW);
    const ceo = await sessionOf('ceo');
    await vi.waitFor(() => expect(sentTo(ceo).join('\n')).toContain('> A plant care app with watering streaks'), SLOW);
    expect((await company()).stakeholder).toBe('Grace');
  });

  it('the CEO reads the catalogue and proposes an org of nine over MCP, which the office shows as its chart', { timeout: STEP_MS }, async () => {
    const stream = await follow(`events/c/${ID}`);
    const { data } = await stream.next<Snapshot>('snapshot', (s) => s.company?.phase === 'proposed');
    stream.close();
    expect(data.company?.proposal).toMatchObject({ company: 'Plant Pal', theme: 'garden', rooms: [{ id: 'direction' }, { id: 'design' }, { id: 'engineering' }] });
    expect(data.company?.proposal?.people.map((p) => p.id)).toEqual(PROPOSAL.people.map((p) => p.id));
    const ceo = pidsOf(await sessionOf('ceo'));
    const calls = log().filter((e) => e.event === 'mcp' && ceo.has(e.pid) && e.method === 'tools/call');
    expect(calls.map((e) => e.status)).toEqual([200, 200]);
  });

  it('starting writes the agents and studio.yaml, and the company runs', { timeout: STEP_MS }, async () => {
    expect((await call(`api/c/${ID}/start`, { body: {} })).status).toBe(200);
    const studio = readFileSync(join(w.project, '.claude', 'studio.yaml'), 'utf8');
    for (const p of PROPOSAL.people) {
      expect(studio).toContain(`id: ${p.id}`);
      expect(readFileSync(join(w.project, '.claude', 'agents', `${p.id}.md`), 'utf8')).toContain(`name: ${p.id}`);
    }
    await vi.waitFor(async () => expect((await company()).phase).toBe('running'), SLOW);
    expect((await company()).people.map((p) => p.id).sort()).toEqual(PROPOSAL.people.map((p) => p.id).sort());
  });

  it('a report in the fixed form reaches the company as the form, the old free-text one still works, and the office keeps its brief file', { timeout: STEP_MS }, async () => {
    const made = (owner: string, title: string, files: string[]) => call(`api/c/${ID}/tasks`, { body: { title, brief: `${title}.`, files, owner, doneWhen: 'It is done.', milestone: null } });
    expect((await made('product-manager', 'Stories', ['docs/stories.md'])).status).toBe(201);
    expect((await made('art-director', 'Drawings', ['docs/drawings.md'])).status).toBe(201);
    const view = await vi.waitFor(async () => {
      const v = await company();
      expect(v.reports.filter((r) => r.taskId === 't-1' || r.taskId === 't-2')).toHaveLength(2);
      return v;
    }, SLOW);
    const form = view.reports.find((r) => r.taskId === 't-1');
    expect(form).toMatchObject({ person: 'product-manager', outcome: 'done', text: 'Stories done.', files: ['docs/stories.md'], open: [], check: { ran: 'node --test', passed: true } });
    const old = view.reports.find((r) => r.taskId === 't-2');
    expect(old).toMatchObject({ person: 'art-director', outcome: 'done', text: 'Drawings sketched.' });
    expect(old?.check).toBeUndefined();
    expect(old?.open).toBeUndefined();
    // Both were the stakeholder's own tasks: done is done, with nobody woken to review it.
    expect(view.tasks.filter((t) => t.id === 't-1' || t.id === 't-2').map((t) => t.status)).toEqual(['done', 'done']);
    // The brief file is the office's: the request word for word, kept in the project's records.
    expect(readFileSync(join(w.project, '.worklings-shared', 'brief.md'), 'utf8')).toContain('A plant care app with watering streaks [fake:found]');
  });

  it('a message to a busy worker reaches their desk at its next step', { timeout: STEP_MS }, async () => {
    const first = await say('ui-designer', '[fake:busy] Start on the palette');
    await vi.waitFor(async () => expect((await company()).people.find((p) => p.id === 'ui-designer')?.desk.state).toBe('working'), SLOW);
    const second = await say('ui-designer', 'Make the palette darker');
    await vi.waitFor(async () => {
      const view = await company();
      expect([messageOf(view, first)?.deliveredAt, messageOf(view, second)?.deliveredAt].every((at) => typeof at === 'number')).toBe(true);
    }, SLOW);
    const kai = await sessionOf('ui-designer');
    const sent = sentTo(kai);
    expect(sent.some((t) => t.includes('Start on the palette'))).toBe(true);
    expect(sent.some((t) => t.includes('Make the palette darker'))).toBe(true);
    // Both reached one process, and the second joined the turn the first began: one turn, so one cost.
    expect(pidsOf(kai).size).toBe(1);
    await vi.waitFor(async () => expect((await company()).people.find((p) => p.id === 'ui-designer')?.desk.state).toBe('idle'), SLOW);
    expect((await company()).spend.samples.filter((s) => s.person === 'ui-designer')).toHaveLength(1);
  });

  it("the lobby counts the desks the hub's gate holds, idle ones included", { timeout: STEP_MS }, async () => {
    await vi.waitFor(async () => {
      const held = (await company()).people.filter((p) => ['starting', 'working', 'idle', 'stopping'].includes(p.desk.state)).length;
      const { hub } = (await call('api/lobby')).body as unknown as LobbyView;
      expect(held).toBeGreaterThan(0);
      expect(hub.inUse).toBe(held);
      // An idle desk keeps its slot, though nobody is at work at it.
      expect(hub.inUse).toBeGreaterThan(hub.working);
    }, SLOW);
  });

  it("a working person's spend moves during their first turn, read from the transcript Claude Code writes", { timeout: STEP_MS }, async () => {
    await say('ux-designer', '[fake:slow] Sketch the watering flow');
    await vi.waitFor(async () => {
      const desk = (await company()).people.find((p) => p.id === 'ux-designer')?.desk;
      expect([desk?.state, Boolean(desk?.sessionId)]).toEqual(['working', true]);
    }, SLOW);
    const lea = await sessionOf('ux-designer');
    // Claude Code writes the session's transcript as the turn goes on, under the folder the desk works in; the fake desk
    // writes none, so these lines are a real desk's, from 2.1.312. No hook comes before the turn ends.
    const folder = transcriptDir(w.project, w.claude);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${lea}.jsonl`), readFileSync(fileURLToPath(new URL('./fixtures/claude-2.1.312/desk/transcript.jsonl', import.meta.url))));
    const view = await vi.waitFor(async () => {
      const v = await company();
      expect(v.people.find((p) => p.id === 'ux-designer')?.cost).toBeGreaterThan(0);
      return v;
    }, SLOW);
    // Still in the turn, which the company hasn't priced: what shows is the transcript's, about two cents of Haiku.
    const person = view.people.find((p) => p.id === 'ux-designer');
    expect(person?.desk.state).toBe('working');
    expect(view.spend.samples.filter((s) => s.person === 'ux-designer')).toEqual([]);
    expect(person?.cost).toBeCloseTo(0.0227, 3);
  });

  it("a relay from a head carries who said it first", { timeout: STEP_MS }, async () => {
    const asked = await say('head-of-design', '[fake:relay] Make the palette darker for the menu');
    let relayed: Message | undefined;
    await vi.waitFor(async () => {
      relayed = (await company()).messages.find((m) => m.from === 'head-of-design' && m.to === 'ui-designer');
      expect(relayed?.deliveredAt).toBeTypeOf('number');
    }, SLOW);
    expect(relayed).toMatchObject({ origin: '@stakeholder', relayOf: asked, note: 'Menu pages first.' });
    const kai = await sessionOf('ui-designer');
    await vi.waitFor(() => expect(sentTo(kai).some((t) => t.startsWith('From Ada, head of design, passing on from Grace'))).toBe(true), SLOW);
  });

  it('a git push waits in the inbox within a second, and allowing it lets the desk carry on', { timeout: STEP_MS }, async () => {
    const stream = await follow(`events/c/${ID}`);
    await say('backend-engineer', '[fake:push] Push the work branch');
    const { data, at } = await stream.next<Snapshot>('snapshot', (s) => (s.company?.approvals ?? []).some((a) => a.person === 'backend-engineer' && a.answer === null));
    stream.close();
    const approval = data.company?.approvals.find((a) => a.person === 'backend-engineer');
    if (!approval) throw new Error('no approval');
    expect(approval).toMatchObject({ tool: 'Bash', kind: 'push', detail: expect.stringContaining('git push origin HEAD') });
    expect(at - approval.askedAt).toBeLessThan(1_000);
    expect(log().some((e) => e.event === 'permission')).toBe(false);
    expect((await call(`api/c/${ID}/approvals`, { body: { approval: approval.id, decision: 'allow' } })).status).toBe(200);
    // The answer applies after the undo window, then the desk's hook hears it and the turn goes on.
    await vi.waitFor(() => expect(log().filter((e) => e.event === 'permission').map((e) => [e.tool, e.behavior])).toEqual([['Bash', 'allow']]), SLOW);
    await vi.waitFor(async () => expect((await company()).spend.samples.some((s) => s.person === 'backend-engineer')).toBe(true), SLOW);
    expect((await company()).approvals.find((a) => a.id === approval.id)?.answer).toMatchObject({ decision: 'allow', always: false });
  });

  it('Stop interrupts a turn and the instruction arrives as the next one', { timeout: STEP_MS }, async () => {
    await say('frontend-engineer', '[fake:long] Build the menu page');
    // A desk shows as working from Claude Code's first line, but its session id comes later, with system/init after
    // the MCP handshake (the order the 2.1.312 fixtures show), so wait for both.
    await vi.waitFor(async () => {
      const desk = (await company()).people.find((p) => p.id === 'frontend-engineer')?.desk;
      expect([desk?.state, Boolean(desk?.sessionId)]).toEqual(['working', true]);
    }, SLOW);
    const sam = await sessionOf('frontend-engineer');
    const stopped = await call(`api/c/${ID}/stop`, { body: { person: 'frontend-engineer', instruction: 'Do the footer first' } });
    expect(stopped.status).toBe(202);
    const id = String(stopped.body.id);
    await vi.waitFor(() => expect(log().some((e) => e.event === 'interrupt' && pidsOf(sam).has(e.pid))).toBe(true), SLOW);
    await vi.waitFor(async () => expect(messageOf(await company(), id)?.deliveredAt).toBeTypeOf('number'), SLOW);
    expect(messageOf(await company(), id)).toMatchObject({ to: 'frontend-engineer', interrupt: true });
    await vi.waitFor(() => expect(sentTo(sam).some((t) => t.includes('Do the footer first'))).toBe(true), SLOW);
  });

  it("the org chart's hire, fire, move and rehire go through the company: the view changes, each is a decision, and Undo takes it back", { timeout: STEP_MS }, async () => {
    const reshape = (action: Record<string, unknown>) => call(`api/c/${ID}/reshape`, { body: action });
    const person = async (id: string) => (await company()).people.find((p) => p.id === id);
    const decision = async (text: string) => (await company()).steering?.decisions.find((d) => d.what.includes(text));

    // A hire without a manager reports to the head of the room it joins, and is a decision.
    const hired = await reshape({ action: 'hire', role: 'copywriter', department: 'design' });
    expect([hired.status, hired.body.ok, hired.body.message]).toEqual([200, true, 'Copywriter joined, reporting to Ada.']);
    expect(await person('copywriter')).toMatchObject({ room: 'design', reportsTo: 'head-of-design' });
    const hiring = await decision('hired');
    expect(hiring).toMatchObject({ by: '@stakeholder', reversible: true });

    // A move changes the room and keeps the manager unless told otherwise.
    expect((await reshape({ action: 'move', role: 'copywriter', department: 'engineering' })).body.ok).toBe(true);
    expect(await person('copywriter')).toMatchObject({ room: 'engineering' });
    expect(await decision('moved')).toBeDefined();

    // A fire leaves the people, and the opposite reshape (what the chart's Undo sends) puts them back.
    expect((await reshape({ action: 'fire', role: 'copywriter' })).body.message).toBe('Copywriter was fired. Their task goes back to Ada.');
    expect(await person('copywriter')).toBeUndefined();
    expect((await reshape({ action: 'rehire', role: 'copywriter' })).body.ok).toBe(true);
    expect(await person('copywriter')).toBeDefined();

    // The decision's own Undo works too: undoing the hire fires them.
    const latest = (await decision('rehired'))?.id;
    expect(latest).toBeTypeOf('string');
    expect((await call(`api/c/${ID}/decisions/${latest}/undo`, { body: {} })).status).toBe(200);
    expect(await person('copywriter')).toBeUndefined();
    expect((await decision('fired'))?.by).toBe('@stakeholder');

    // Refusals are sentences, and nothing changes.
    const unknownRoom = await reshape({ action: 'hire', role: 'copywriter', department: 'no-such-room' });
    expect([unknownRoom.status, String(unknownRoom.body.error)]).toEqual([400, expect.stringContaining('no-such-room')]);
    const fired = await reshape({ action: 'hire', role: 'seo-specialist', department: 'design', reportsTo: 'nobody-here' });
    expect(fired.status).toBe(400);
    const ceo = await reshape({ action: 'fire', role: 'ceo' });
    expect(ceo.body).toMatchObject({ ok: false, message: expect.stringContaining("can't be fired") });
    expect((await reshape({ action: 'move', role: 'ux-designer' })).status).toBe(400);
    expect((await reshape({ action: 'fire', role: 'ux-designer', reportsTo: 'ceo' })).status).toBe(400);
    expect((await reshape({ action: 'fire', role: '../x' })).status).toBe(400);
    // A model or a rule belongs to the file edits, so the four org actions refuse them in words instead of dropping them.
    for (const action of ['hire', 'fire', 'move', 'rehire']) {
      for (const field of ['model', 'rule']) {
        const refused = await reshape({ action, role: 'ux-designer', department: 'design', [field]: field === 'model' ? 'opus' : 'Be kind.' });
        expect([action, field, refused.status, String(refused.body.error)]).toEqual([action, field, 400, `${action} doesn't take ${field}.`]);
      }
    }
    expect(await person('ux-designer')).toBeDefined();
  });

  it('a usage limit pauses the company until the reset time it reported', { timeout: STEP_MS }, async () => {
    await say('devops-engineer', '[fake:limit] Run the tests');
    await vi.waitFor(async () => expect((await company()).pause).toMatchObject({ reason: 'usage-limit', until: RESETS_AT_S * 1000 }), SLOW);
    expect(((await call('api/lobby')).body as unknown as LobbyView).companies[0]?.pause).toMatchObject({ reason: 'usage-limit', until: RESETS_AT_S * 1000 });
  });

  it('a restarted hub reopens the company and delivers a held message once, on the same session', { timeout: STEP_MS }, async () => {
    const kai = await sessionOf('ui-designer');
    const held = await say('ui-designer', 'Check the contrast of the streak card');
    await vi.waitFor(async () => expect((await company()).people.find((p) => p.id === 'ui-designer')?.desk.state).toBe('waiting'), SLOW);
    expect(messageOf(await company(), held)?.deliveredAt).toBeNull();
    const before = log().filter((e) => e.event === 'start').map((e) => e.pid);
    // Lea's first turn was killed with the desk, so only her transcript priced it (the earlier step): it must outlive the restart.
    const costOf = (view: CompanyView, id: string) => view.people.find((p) => p.id === id)?.cost ?? 0;
    expect(costOf(await company(), 'ux-designer')).toBeCloseTo(0.0227, 3);
    await w.hub.close();
    // Closing the hub closes every desk with its processes.
    await vi.waitFor(() => expect(before.filter(alive)).toEqual([]), SLOW);
    w.hub = await open(w);
    // The first look after the restart already carries what each person had cost, before any desk or transcript is read.
    expect(costOf(await company(), 'ux-designer')).toBeCloseTo(0.0227, 3);
    expect(((await call('api/lobby')).body as unknown as LobbyView).companies[0]?.spend).toBeGreaterThan(0.0227);
    expect(((await call('api/lobby')).body as unknown as LobbyView).companies).toMatchObject([{ id: ID, phase: 'running', pause: { reason: 'usage-limit' } }]);
    expect(messageOf(await company(), held)?.deliveredAt).toBeNull();
    expect((await call(`api/c/${ID}/resume`, { body: {} })).status).toBe(200);
    await vi.waitFor(async () => expect(messageOf(await company(), held)?.deliveredAt).toBeTypeOf('number'), SLOW);
    const resumed = log().filter((e) => e.event === 'start' && e.argv?.includes('--resume') && e.argv.includes(kai));
    expect(resumed.length).toBeGreaterThan(0);
    const lines = log().filter((e) => e.event === 'line' && textOf(e).includes('Check the contrast of the streak card'));
    expect(lines).toHaveLength(1);
    expect(resumed.map((e) => e.pid)).toContain(lines[0]?.pid);
    expect(await sessionOf('ui-designer')).toBe(kai);
  });

  it('closing the hub leaves no desk running, and stops the dev server one left behind but nothing beside it', { timeout: STEP_MS }, async () => {
    // A process that isn't a desk's, started here: closing the hub must not touch it.
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true, detached: true });
    other.unref();
    try {
      await say('ui-designer', '[fake:server] Start the dev server');
      await vi.waitFor(() => expect(log().some((e) => e.event === 'orphan')).toBe(true), SLOW);
      const server = log().find((e) => e.event === 'orphan')?.childPid ?? 0;
      expect(alive(server)).toBe(true);
      const pids = log().filter((e) => e.event === 'start').map((e) => e.pid);
      await w.hub.close();
      await vi.waitFor(() => expect({ server, left: [...pids, server].filter(alive) }).toEqual({ server, left: [] }), SLOW);
      expect(alive(other.pid ?? 0)).toBe(true);
    } finally {
      other.kill(); // the process this test started
    }
  });
});
