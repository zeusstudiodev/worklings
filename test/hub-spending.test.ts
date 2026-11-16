// v0.2's spending plan through the real hub, with only Claude Code faked (test/fake-desk.mjs): the CEO drafts at once from a
// clear prompt, with no model on its people and no word of the preset; the stakeholder never answers "How thorough?" and
// the company still starts (what an unattended run does); then the routes the proposal's form uses, over HTTP as the
// browser does: the preset, the models by level and the budget, each with its refusals and its status. The steps share one
// company and run in order.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import type { CompanyView } from '../src/core/company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import { tempDir } from './library-kit.ts';
import { FAKE_DESK, type FakeLogEntry } from './runtime-kit.ts';

const TOKEN = 'spending-token-0123456789abcdefghijklmnop';
const ID = 'link-checker';
const SLOW = { timeout: 60_000, interval: 50 };
const STEP_MS = 120_000;

/** What a CEO writes when it leaves the models and the preset out: two people, a sizing sentence that names no preset. */
const DRAFT = {
  company: 'Link Checker',
  goal: 'A one-file CLI that finds broken links in a folder of Markdown docs.',
  size: 'small',
  sizing: 'One small CLI, so one engineer builds it and I manage them myself.',
  theme: 'office',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  people: [
    { id: 'ceo', name: 'Noor', title: 'CEO', level: 'ceo', room: 'direction', reportsTo: null, model: 'inherit', owns: 'The company, its goal and the line to the stakeholder', library: 'ceo' },
    { id: 'library-engineer', name: 'Ivo', title: 'CLI engineer', level: 'worker', room: 'engineering', reportsTo: 'ceo', owns: 'The CLI, its tests and its README', library: 'library-engineer' },
  ],
  questions: [],
};

const SCRIPT = {
  default: [{ say: 'On it.' }],
  byText: [{ includes: 'You are founding a new company', scenario: 'draft' }],
  scenarios: { draft: [{ org: 'propose_org', arguments: DRAFT }, { say: 'I proposed two people.' }] },
};

let hub: RunningHub;
let logFile = '';
let project = '';

const call = async (path: string, body?: unknown, auth = true) => {
  const res = await fetch(`${hub.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> & { error?: string } };
};

async function company(): Promise<CompanyView> {
  const snapshot = (await call(`api/c/${ID}/state`)).body as unknown as Snapshot;
  if (!snapshot.company) throw new Error('the snapshot has no company');
  return snapshot.company;
}

const textOf = (e: FakeLogEntry): string => {
  const content = (e.line?.message as { content?: unknown } | undefined)?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? '').join('') : '';
};
/** Every user turn the desks were sent, in order. */
const sent = (): string[] => {
  try {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry);
    return lines.filter((e) => e.event === 'line' && e.line?.type === 'user').map(textOf);
  } catch {
    return [];
  }
};

beforeAll(async () => {
  const dir = tempDir('worklings-spending-');
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', gitconfig);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(SCRIPT));
  logFile = join(dir, 'desk.jsonl');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  mkdirSync(join(dir, 'projects'));
  project = join(dir, 'projects', ID);
  mkdirSync(project);
  const home = join(dir, 'home');
  mkdirSync(home);
  // No ANTHROPIC_MODEL, whatever this machine has: the preset's models are what is under test.
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN', 'ANTHROPIC_MODEL'].includes(name.toUpperCase()));
  const env = {
    ...Object.fromEntries(kept), WORKLINGS_CLAUDE: FAKE_DESK, FAKE_DESK_SCRIPT: scriptFile, FAKE_DESK_LOG: logFile, FAKE_DESK_SESSIONS: join(dir, 'sessions'),
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
  };
  hub = await startHub({
    port: 0, token: TOKEN, webDir: null, library: loadLibrary(), home, env, claudeHome: join(dir, 'claude'), tickMs: 25,
    desks: { scratch }, aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') },
  });
}, STEP_MS);

afterAll(async () => {
  await hub?.close();
  vi.unstubAllEnvs();
}, STEP_MS);

describe('the spending plan through the hub, with only Claude Code faked', () => {
  it('founds a company on Balanced with "How thorough?" open, and a CEO told the preset in its opening turn', { timeout: STEP_MS }, async () => {
    const created = await call('api/companies', { folder: project, prompt: 'A link checker for my docs' });
    expect(created.status).toBe(201);
    await vi.waitFor(() => expect(sent().join('\n')).toContain('Thoroughness: Balanced (the default until the stakeholder chooses)'), SLOW);
    const opening = sent()[0] ?? '';
    expect(opening).toContain('small, medium or large');
    expect(opening).toContain('Up to 5 work at once');
    expect(opening).toContain('The office asks the stakeholder "How thorough?" itself');
    const view = await company();
    expect(view.settings).toMatchObject({ preset: 'balanced', maxDesks: 5, budget: { company: null, person: null } });
    expect(view.spending?.presetQuestion).toEqual(expect.any(String));
  });

  it('takes the CEO’s proposal with no models: its people get Opus and Sonnet, and the sizing names the preset', { timeout: STEP_MS }, async () => {
    await vi.waitFor(async () => expect((await company()).phase).toBe('proposed'), SLOW);
    const view = await company();
    expect(view.proposal?.people.map((p) => [p.id, p.model])).toEqual([['ceo', 'opus'], ['library-engineer', 'sonnet']]);
    expect(view.proposal?.sizing).toBe('Balanced: One small CLI, so one engineer builds it and I manage them myself.');
    // Two people sit inside Balanced's 3 to 10 only barely: they are under it, and the form is told.
    expect(view.spending?.outside).toEqual({ side: 'under', people: 2, min: 3, max: 10 });
    expect(view.spending?.loads?.byPerson['library-engineer']?.tokens).toBe(13_000);
    expect(view.spending?.job?.basis).toBe('proposal');
    expect(view.spending?.presets.map((p) => p.id)).toEqual(['lean', 'balanced', 'thorough']);
    // The question is still open beside the chart: the form shows the selector, nobody has to answer.
    expect(view.inbox).toBe(2);
  });

  it('sets the preset over HTTP, moves the models that followed the old one and tells the CEO', { timeout: STEP_MS }, async () => {
    const before = sent().length;
    const res = await call(`api/c/${ID}/preset`, { preset: 'thorough' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preset: 'thorough', maxDesks: 8, models: { ceo: 'opus', head: 'opus', lead: 'sonnet', worker: 'sonnet' } });
    await vi.waitFor(() => expect(sent().length).toBeGreaterThan(before), SLOW);
    expect(sent().slice(before).join('\n')).toContain('chose Thorough for how thorough the company is');
    const view = await company();
    expect(view.spending?.presetQuestion).toBeNull();
    expect(view.spending?.outside).toEqual({ side: 'under', people: 2, min: 6, max: 25 });
  });

  it('sets the models by level in one action, and refuses what it cannot read', { timeout: STEP_MS }, async () => {
    const res = await call(`api/c/${ID}/models`, { ceo: 'sonnet', worker: 'haiku' });
    expect(res.status).toBe(200);
    expect((res.body.settings as { models: unknown }).models).toEqual({ ceo: 'sonnet', head: 'opus', lead: 'sonnet', worker: 'haiku' });
    const people = (res.body.proposal as { people: { id: string; model: string }[] }).people;
    expect(people.map((p) => [p.id, p.model])).toEqual([['ceo', 'sonnet'], ['library-engineer', 'haiku']]);
    expect((await call(`api/c/${ID}/models`, {})).body.error).toBe('Send the model for a level: ceo, head, lead, worker.');
    expect((await call(`api/c/${ID}/models`, { head: 'gpt-9' })).status).toBe(400);
    expect((await call(`api/c/${ID}/models`, { boss: 'opus' })).body.error).toBe('This takes ceo, head, lead, worker, not boss.');
    expect((await call(`api/c/${ID}/preset`, { preset: 'huge' })).body.error).toBe('preset must be "lean" or "balanced" or "thorough".');
  });

  it('sets the budget over HTTP: dollars to the cent, null to clear, and refusals with their sentences', { timeout: STEP_MS }, async () => {
    const set = await call(`api/c/${ID}/budget`, { company: 25, person: 4.5 });
    expect([set.status, set.body.budget]).toEqual([200, { company: 25, person: 4.5 }]);
    expect((await call(`api/c/${ID}/budget`, { person: null })).body.budget).toEqual({ company: 25, person: null });
    expect((await company()).settings.budget).toEqual({ company: 25, person: null });
    const refusal = 'company must be a dollar amount from $0.01 to $1,000,000, or null for none.';
    for (const bad of [0, -3, '25', 5_000_000]) expect([(await call(`api/c/${ID}/budget`, { company: bad })).status, (await call(`api/c/${ID}/budget`, { company: bad })).body.error]).toEqual([400, refusal]);
    expect((await call(`api/c/${ID}/budget`, {})).body.error).toBe('Send company or person: a dollar amount, or null for none.');
    expect((await call(`api/c/${ID}/budget`, { team: 5 })).body.error).toBe('This takes company, person, not team.');
  });

  it('wants the token, like every other change', { timeout: STEP_MS }, async () => {
    for (const path of ['preset', 'budget', 'models']) expect((await call(`api/c/${ID}/${path}`, { preset: 'lean' }, false)).status).toBe(401);
  });

  it('starts with the question never answered, as an unattended run does, and then refuses a new preset with a 409', { timeout: STEP_MS }, async () => {
    expect((await call(`api/c/${ID}/start`, {})).status).toBe(200);
    await vi.waitFor(async () => expect((await company()).phase).toBe('running'), SLOW);
    const view = await company();
    expect(view.settings.preset).toBe('thorough');
    expect(view.people.map((p) => [p.id, p.model])).toEqual([['ceo', 'sonnet'], ['library-engineer', 'haiku']]);
    expect(view.inbox).toBe(0);
    const late = await call(`api/c/${ID}/preset`, { preset: 'lean' });
    expect([late.status, late.body.code]).toEqual([409, 'conflict']);
    expect((await call(`api/c/${ID}/models`, { head: 'opus' })).status).toBe(409);
    // The budget can still change while it runs.
    expect((await call(`api/c/${ID}/budget`, { company: 60 })).status).toBe(200);
  });
});
