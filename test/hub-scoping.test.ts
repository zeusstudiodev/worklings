// The CEO's scoping questions through the real hub (Robin, 12 Nov 2026), with only Claude Code faked
// (test/fake-desk.mjs): the CEO asks before it drafts, the stakeholder answers over HTTP as the browser does (a press,
// their own words, then "Use the CEO's picks"), the answers reach the CEO's desk in one turn, and it proposes an org
// sized to the goal, here the CEO and one maker. The steps share one company and run in order.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { type CompanyView, UNDO_MS } from '../src/core/company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import { tempDir } from './library-kit.ts';
import { FAKE_DESK, type FakeLogEntry } from './runtime-kit.ts';

const TOKEN = 'scoping-token-0123456789abcdefghijklmnop';
const ID = 'link-checker';
const SLOW = { timeout: 60_000, interval: 50 };
const STEP_MS = 120_000;

const SCOPING = [
  { text: 'Who is it for?', options: ['Just me', 'My team', 'Anyone, as an npm package'], recommended: 0, why: 'You said it checks your own docs.' },
  { text: 'How far should the first version go?', options: ['One command that works', 'A polished tool with options'], recommended: 0, why: 'One file and one command is what you asked for.' },
  { text: 'What must it check?', options: ['Links inside the docs', 'Outside links too'], recommended: 1, why: 'Broken outside links are the ones that rot.' },
];

/** A single small deliverable: the CEO and one maker who reports to it, no heads. */
const SMALL = {
  company: 'Link Checker',
  goal: 'A one-file CLI that finds broken links in a folder of Markdown docs.',
  size: 'small',
  sizing: 'Two people: one small CLI, so one engineer builds it and I manage them myself.',
  theme: 'office',
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  people: [
    { id: 'ceo', name: 'Noor', title: 'CEO', level: 'ceo', room: 'direction', reportsTo: null, model: 'sonnet', owns: 'The company, its goal and the line to the stakeholder', library: 'ceo' },
    { id: 'library-engineer', name: 'Ivo', title: 'CLI engineer', level: 'worker', room: 'engineering', reportsTo: 'ceo', model: 'sonnet', owns: 'The CLI, its tests and its README', library: 'library-engineer' },
  ],
  questions: [],
};

const SCRIPT = {
  default: [{ say: 'On it.' }],
  byText: [{ includes: 'Answers to your scoping questions', scenario: 'draft' }],
  scenarios: {
    scope: [{ org: 'ask_scoping', arguments: { questions: SCOPING } }, { say: 'I asked three questions before drafting.' }],
    draft: [{ org: 'propose_org', arguments: SMALL }, { say: 'I proposed two people.' }],
  },
};

let hub: RunningHub;
let logFile = '';
let project = '';

const call = async (path: string, body?: unknown) => {
  const res = await fetch(`${hub.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as unknown };
};

async function company(): Promise<CompanyView> {
  const snapshot = (await call(`api/c/${ID}/state`)).body as Snapshot;
  if (!snapshot.company) throw new Error('the snapshot has no company');
  return snapshot.company;
}

function log(): FakeLogEntry[] {
  try {
    return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry);
  } catch {
    return [];
  }
}
const textOf = (e: FakeLogEntry): string => {
  const content = (e.line?.message as { content?: unknown } | undefined)?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? '').join('') : '';
};
/** Every user turn the CEO's desks were sent, in order. */
const sentToCeo = (): string[] => log().filter((e) => e.event === 'line' && e.line?.type === 'user').map(textOf);

beforeAll(async () => {
  const dir = tempDir('worklings-scoping-');
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
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN'].includes(name.toUpperCase()));
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

describe("the CEO's scoping through the hub, with only Claude Code faked", () => {
  it('asks its questions before drafting: they wait in the inbox with its picks and whys, and nothing is proposed', { timeout: STEP_MS }, async () => {
    const created = await call('api/companies', { folder: project, prompt: 'A link checker for my docs [fake:scope]' });
    expect(created.status).toBe(201);
    // The opening turn tells the CEO to scope a short prompt first.
    await vi.waitFor(() => expect(sentToCeo().join('\n')).toContain('your first move is ask_scoping'), SLOW);
    await vi.waitFor(async () => expect((await company()).scoping?.questions).toHaveLength(3), SLOW);
    const view = await company();
    expect(view.phase).toBe('founding');
    expect(view.proposal).toBeNull();
    // The office's "How thorough?" is open beside the CEO's three.
    expect(view.inbox).toBe(4);
    const asked = view.questions.filter((q) => view.scoping?.questions.includes(q.id));
    expect(asked.map((q) => [q.text, q.options, q.recommended, q.why])).toEqual(SCOPING.map((q) => [q.text, q.options, q.recommended, q.why]));
    expect(view.log.map((e) => e.kind)).toEqual(['founded', 'scoping']);
    // The MCP call went through: one tools/call, answered.
    const calls = log().filter((e) => e.event === 'mcp' && e.method === 'tools/call');
    expect(calls.map((e) => e.status)).toEqual([200]);
  });

  it('takes a press, own words and the CEO’s picks, and hands the CEO all of them in one turn', { timeout: STEP_MS }, async () => {
    const view = await company();
    const [first, second] = view.scoping?.questions ?? [];
    const turnsBefore = sentToCeo().length;
    expect((await call(`api/c/${ID}/answers`, { question: first, option: 1 })).status).toBe(200);
    expect((await call(`api/c/${ID}/answers`, { question: second, text: 'One command I can run in CI.' })).status).toBe(200);
    const picks = await call(`api/c/${ID}/scoping/picks`, {});
    expect(picks.status).toBe(200);
    expect((picks.body as { id: string; answer: { option: number } }[]).map((q) => q.answer.option)).toEqual([1]);
    // Nothing left to pick, said as a sentence.
    const again = await call(`api/c/${ID}/scoping/picks`, {});
    expect([again.status, (again.body as { error?: string }).error]).toEqual([409, 'There are no open questions from the CEO to answer with its picks.']);
    expect(sentToCeo()).toHaveLength(turnsBefore);
    // After the undo window, one turn carries every answer; the CEO drafts from it.
    await new Promise((done) => setTimeout(done, UNDO_MS));
    await vi.waitFor(async () => expect((await company()).scoping?.answeredAt).toEqual(expect.any(Number)), SLOW);
    await vi.waitFor(() => expect(sentToCeo().length).toBeGreaterThan(turnsBefore), SLOW);
    const turn = sentToCeo()[turnsBefore] ?? '';
    expect(turn).toContain('Answers to your scoping questions:');
    expect(turn).toContain('1. Who is it for?\n   My team.');
    expect(turn).toContain('2. How far should the first version go?\n   In their own words: One command I can run in CI.');
    expect(turn).toContain('3. What must it check?\n   Outside links too (your pick).');
    expect(sentToCeo().filter((t) => t.includes('Answers to your scoping questions'))).toHaveLength(1);
  });

  it('proposes an org sized to the goal, the CEO and one maker, with its reason, and starts it', { timeout: STEP_MS }, async () => {
    await vi.waitFor(async () => expect((await company()).phase).toBe('proposed'), SLOW);
    const view = await company();
    expect(view.proposal?.people.map((p) => [p.id, p.level, p.reportsTo])).toEqual([['ceo', 'ceo', null], ['library-engineer', 'worker', 'ceo']]);
    // The office puts the preset's name in front when the CEO's sentence doesn't name it.
    expect(view.proposal?.sizing).toBe('Balanced: Two people: one small CLI, so one engineer builds it and I manage them myself.');
    expect(view.scoping?.answeredAt).toEqual(expect.any(Number));
    expect((await call(`api/c/${ID}/start`, {})).status).toBe(200);
    await vi.waitFor(async () => expect((await company()).phase).toBe('running'), SLOW);
    expect((await company()).people.map((p) => p.id).sort()).toEqual(['ceo', 'library-engineer']);
    expect(readFileSync(join(project, '.claude', 'studio.yaml'), 'utf8')).toContain('id: library-engineer');
  });
});
