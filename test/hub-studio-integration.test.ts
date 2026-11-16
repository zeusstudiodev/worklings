// v0.3, the studio over many companies, through the real hub with every real part and only Claude Code faked
// (test/fake-desk.mjs): two companies, the studio chat asking both CEOs and passing their answers on, and a portfolio
// whose shared budget, once spent, pauses both companies until it is raised. Over HTTP as the browser does. The steps
// build on each other, so they run in order.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { type CompanyView, STAKEHOLDER } from '../src/core/company.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import { type RunningHub, startHub } from '../src/hub/index.ts';
import type { PortfolioView, StudioLobbyView } from '../src/studio/model.ts';
import { tempDir } from './library-kit.ts';
import { FAKE_DESK, type FakeLogEntry } from './runtime-kit.ts';

const TOKEN = 'studio-integration-token-0123456789abcdef';
const SLOW = { timeout: 60_000, interval: 50 };
const STEP_MS = 120_000;

const proposal = (company: string, goal: string, theme: string) => ({
  company,
  goal,
  size: 'small',
  sizing: 'One page and its data, so one engineer and the CEO.',
  theme,
  rooms: [
    { id: 'direction', title: 'Direction', style: 'direction' },
    { id: 'engineering', title: 'Engineering', style: 'engineering' },
  ],
  people: [
    { id: 'ceo', name: 'Mara', title: 'CEO', level: 'ceo', room: 'direction', reportsTo: null, model: 'opus', owns: 'The company and the line to the stakeholder', library: 'ceo' },
    { id: 'frontend-engineer', name: 'Sam', title: 'Frontend engineer', level: 'worker', room: 'engineering', reportsTo: 'ceo', model: 'sonnet', owns: 'The pages', library: 'frontend-engineer' },
  ],
  questions: [],
});

/** Each desk's turn by what it says: the CEOs propose, answer the studio chat in their own words, or spend; the studio chat asks both. */
const SCRIPT = {
  default: [{ say: 'On it.' }],
  scenarios: {
    'found-plant': [{ org: 'propose_org', arguments: proposal('Plant Pal', 'A plant care app with watering streaks.', 'garden') }, { say: 'Proposed.' }],
    'found-bakery': [{ org: 'propose_org', arguments: proposal('Corner Bakery', 'A bakery site with pickup orders.', 'office') }, { say: 'Proposed.' }],
    'answer-plant': [{ say: 'Plant Pal: the watering flow is done, reminders are next.' }],
    'answer-bakery': [{ say: 'Corner Bakery: the menu page is up, pickup slots are next.' }],
    // Twelve requests at the fake's $0.001 each: $0.012 a company.
    spend: Array.from({ length: 12 }, (_, i) => ({ say: `Step ${i + 1}.` })),
    'studio-ask': [
      { org: 'list_companies', arguments: {} },
      { org: 'message_ceos', arguments: { to: { all: true }, text: 'How far along are you? One line, please.' } },
      { org: 'collect_replies', arguments: { wait_seconds: 8 } },
      { sayResult: 'Both CEOs answered.' },
    ],
    'studio-leak': [{ org: 'message_ceos', arguments: { to: { company: 'corner-bakery' }, text: 'Plant Pal says: the watering flow is done, reminders are next. Do the same.' } }, { sayResult: 'Tried.' }],
    // Reads one company, then passes it on reworded, naming it in share_from: only a turn whose message names it lets it go.
    'studio-pass-on': [
      { org: 'read_company', arguments: { company: 'plant-pal', parts: ['progress'] } },
      { org: 'message_ceos', arguments: { to: { company: 'corner-bakery' }, text: 'The other team has its main flow built; how close is yours?', share_from: ['plant-pal'] } },
      { sayResult: 'Tried.' },
    ],
  },
  byText: [
    { includes: 'From the studio chat', folder: 'plant', scenario: 'answer-plant' },
    { includes: 'From the studio chat', folder: 'bakery', scenario: 'answer-bakery' },
  ],
};

interface World {
  dir: string;
  logFile: string;
  hub: RunningHub;
}
let w: World;

const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
  const res = await fetch(`${w.hub.url}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${init.token ?? TOKEN}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> };
};
const lobby = async () => (await call('api/lobby')).body as unknown as StudioLobbyView;
const snapshotOf = async (id: string) => (await call(`api/c/${id}/state`)).body as unknown as Snapshot & { portfolio?: { id: string; name: string; held: boolean } | null };
const viewOf = async (id: string): Promise<CompanyView> => {
  const s = await snapshotOf(id);
  if (!s.company) throw new Error(`${id} has no company`);
  return s.company;
};
function log(): FakeLogEntry[] {
  try {
    return readFileSync(w.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry);
  } catch {
    return [];
  }
}
const textOf = (e: FakeLogEntry): string => {
  const content = (e.line?.message as { content?: unknown } | undefined)?.content;
  return typeof content === 'string' ? content : '';
};

beforeAll(async () => {
  const dir = tempDir('worklings-studio-');
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n[init]\n\tdefaultBranch = main\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', gitconfig);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(SCRIPT));
  const scratch = join(dir, 'scratch');
  for (const d of [scratch, join(dir, 'home'), join(dir, 'projects'), join(dir, 'claude')]) mkdirSync(d, { recursive: true });
  const kept = Object.entries(process.env).filter(([name]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE', 'WORKLINGS_DESK_TOKEN', 'ANTHROPIC_MODEL'].includes(name.toUpperCase()));
  const logFile = join(dir, 'desk.jsonl');
  const env = {
    ...Object.fromEntries(kept), WORKLINGS_CLAUDE: FAKE_DESK, FAKE_DESK_SCRIPT: scriptFile, FAKE_DESK_LOG: logFile, FAKE_DESK_SESSIONS: join(dir, 'sessions'),
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
  };
  const hub = await startHub({
    port: 0, token: TOKEN, webDir: null, library: loadLibrary(), home: join(dir, 'home'), env, claudeHome: join(dir, 'claude'), tickMs: 25,
    desks: { scratch }, aside: { env: { PATH: tempDir('worklings-no-claude-') }, workRoot: tempDir('worklings-work-') },
  });
  w = { dir, logFile, hub };
}, STEP_MS);

afterAll(async () => {
  await w?.hub.close();
  vi.unstubAllEnvs();
}, STEP_MS);

async function found(folder: string, prompt: string): Promise<string> {
  const made = await call('api/companies', { body: { folder: join(w.dir, 'projects', folder), prompt } });
  expect(made.status).toBe(201);
  const id = String(made.body.id);
  await vi.waitFor(async () => expect((await viewOf(id)).phase).toBe('proposed'), SLOW);
  expect((await call(`api/c/${id}/start`, { body: {} })).status).toBe(200);
  await vi.waitFor(async () => expect((await viewOf(id)).phase).toBe('running'), SLOW);
  return id;
}

describe('the studio over two companies, with only Claude Code faked', () => {
  let plant = '';
  let bakery = '';

  it('two companies run, each with its own CEO', { timeout: STEP_MS }, async () => {
    plant = await found('plant-pal', 'A plant care app with watering streaks [fake:found-plant]');
    bakery = await found('corner-bakery', 'A bakery site with pickup orders [fake:found-bakery]');
    expect([plant, bakery]).toEqual(['plant-pal', 'corner-bakery']);
    const l = await lobby();
    expect(l.portfolios).toEqual([]);
    expect(l.studio).toMatchObject({ model: 'sonnet', state: 'idle', entries: [] });
    // Idle costs nothing: no desk has started for the studio chat.
    expect(log().filter((e) => e.event === 'start' && e.argv?.includes('--append-system-prompt') && JSON.stringify(e.argv).includes('studio chat'))).toEqual([]);
  });

  it('the studio chat asks both CEOs over its tools, and their answers come back in the chat, each in its own words', { timeout: STEP_MS }, async () => {
    const sent = await call('api/studio/messages', { body: { text: '[fake:studio-ask] How far along is everyone?' } });
    expect(sent.status).toBe(202);
    const done = await vi.waitFor(async () => {
      const s = (await lobby()).studio;
      expect(s.entries.map((e) => e.kind)).toContain('studio');
      return s;
    }, SLOW);
    const relay = done.entries.find((e) => e.kind === 'relay');
    expect(relay?.companies?.map((c) => c.id).sort()).toEqual([bakery, plant].sort());
    const replies = done.entries.filter((e) => e.kind === 'reply');
    expect(replies.map((r) => [r.companies?.[0]?.id, r.text, r.by]).sort()).toEqual(
      [
        [bakery, 'Corner Bakery: the menu page is up, pickup slots are next.', 'Mara, the CEO'],
        [plant, 'Plant Pal: the watering flow is done, reminders are next.', 'Mara, the CEO'],
      ].sort(),
    );
    const answer = done.entries.find((e) => e.kind === 'studio');
    expect(answer?.text).toContain('Plant Pal: the watering flow is done');
    expect(answer?.text).toContain('Corner Bakery: the menu page is up');
    // Each answer shows what it cost.
    expect(answer?.cost).toBeGreaterThan(0);
    expect(done.spent).toBeGreaterThan(0);

    // Each CEO got a fenced turn from the studio chat, never the stakeholder's words.
    const ceoTurns = log().filter((e) => e.event === 'line' && e.line?.type === 'user' && textOf(e).includes('How far along are you?'));
    expect(ceoTurns).toHaveLength(2);
    for (const e of ceoTurns) {
      const [head = '', open, words, close] = textOf(e).split('\n');
      expect(head).toMatch(/^From the studio chat, which asks for Grace across their companies and decides nothing \(message m-\d+; answer it in your turn's last words\), between the two \w+ lines:$/);
      expect([open, words, close]).toEqual([open, 'How far along are you? One line, please.', open]);
    }
    // The company's feed has it as the studio chat's message, which never counts as the stakeholder's word.
    for (const id of [plant, bakery]) {
      const m = (await viewOf(id)).messages.find((x) => x.text === 'How far along are you? One line, please.');
      expect(m).toMatchObject({ from: STAKEHOLDER, to: 'ceo', fromStudio: true, fromOffice: true });
      expect(m?.typed).toBeUndefined();
    }

    // The studio chat's desk was lean: no built-in tools, only its own server, on Sonnet, and its token never on the command line.
    const start = log().find((e) => e.event === 'start' && JSON.stringify(e.argv ?? []).includes('the studio chat in Worklings'));
    const argv = start?.argv ?? [];
    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv[argv.indexOf('--model') + 1]).toBe('sonnet');
    expect(JSON.stringify(start)).not.toMatch(/[0-9a-f]{64}/);
  });

  it("the studio chat can't carry one company's words to another's CEO", { timeout: STEP_MS }, async () => {
    expect((await call('api/studio/messages', { body: { text: '[fake:studio-leak] Tell the bakery what Plant Pal said.' } })).status).toBe(202);
    const s = await vi.waitFor(async () => {
      const v = (await lobby()).studio;
      expect(v.entries.at(-1)?.kind).toBe('studio');
      return v;
    }, SLOW);
    expect(s.entries.at(-1)?.text).toContain("This would carry words from Plant Pal's records to Corner Bakery's CEO.");
    const bakeryView = await viewOf(bakery);
    expect(bakeryView.messages.some((m) => m.text.includes('Plant Pal says'))).toBe(false);
  });

  it("passes on what it read of one company only in a turn whose own message names it", { timeout: STEP_MS }, async () => {
    const turn = async (text: string) => {
      const before = (await lobby()).studio.entries.length;
      expect((await call('api/studio/messages', { body: { text } })).status).toBe(202);
      return vi.waitFor(async () => {
        const v = (await lobby()).studio;
        expect(v.entries.length).toBeGreaterThan(before);
        expect(v.entries.at(-1)?.kind).toBe('studio');
        return v.entries.at(-1)?.text ?? '';
      }, SLOW);
    };
    // The message before named Plant Pal; this one doesn't, so what the chat read stays where it is.
    expect(await turn('[fake:studio-pass-on] Pass that on, please.')).toBe(
      "Tried. The stakeholder's message that started this turn doesn't name Plant Pal, so what you read there stays there.",
    );
    expect((await viewOf(bakery)).messages.some((m) => m.text.startsWith('The other team'))).toBe(false);
    expect(await turn("[fake:studio-pass-on] Tell the bakery how far Plant Pal's main flow is.")).toMatch(/^Tried\. Relay r-\d+: "The other team has its main flow built/);
    await vi.waitFor(async () => expect((await viewOf(bakery)).messages.some((m) => m.text.startsWith('The other team') && m.fromStudio === true)).toBe(true), SLOW);
  });

  it("a portfolio rolls both companies up, and once its shared budget is spent both pause, with the inbox saying why, until it's raised", { timeout: STEP_MS }, async () => {
    const made = await call('api/portfolios', { body: { name: 'Client work', companies: [plant, bakery], budget: 1000, brief: 'Every site is bilingual, German first.' } });
    expect(made.status).toBe(201);
    const id = String(made.body.id);
    // The shared brief reaches each CEO through its brief file.
    for (const folder of ['plant-pal', 'corner-bakery']) {
      await vi.waitFor(() => expect(readFileSync(join(w.dir, 'projects', folder, '.worklings-shared', 'brief.md'), 'utf8')).toContain('Every site is bilingual, German first.'), SLOW);
    }
    // Both spend: twelve requests each.
    for (const c of [plant, bakery]) expect((await call(`api/c/${c}/messages`, { body: { to: 'ceo', text: '[fake:spend] Go.' } })).status).toBe(202);
    const spent = await vi.waitFor(async () => {
      const p = (await lobby()).portfolios.find((x) => x.id === id) as PortfolioView;
      expect(p.spent).toBeGreaterThanOrEqual(0.024);
      return p.spent;
    }, SLOW);
    // The budget comes down to what they spent: both companies pause as at their own budget.
    expect((await call(`api/portfolios/${id}`, { body: { budget: Math.floor(spent * 100) / 100 } })).status).toBe(200);
    const held = await vi.waitFor(async () => {
      const l = await lobby();
      const p = l.portfolios.find((x) => x.id === id) as PortfolioView;
      expect(p.held).toBe(true);
      return l;
    }, SLOW);
    const p = held.portfolios.find((x) => x.id === id) as PortfolioView;
    expect(p.line).toMatch(/^Paused: its \$0\.\d\d budget is spent\.$/);
    for (const c of [plant, bakery]) {
      const entry = held.companies.find((x) => x.id === c);
      expect(entry?.pause?.message).toMatch(/^Paused: the Client work portfolio's \$0\.\d\d budget is spent\. Raise it on the portfolio in the lobby to carry on\.$/);
      expect(entry?.summary?.stage).toBe('paused');
      const snap = await snapshotOf(c);
      // The company's own inbox says why, and where the portfolio is.
      expect(snap.company?.pause?.reason).toBe('budget');
      expect(snap.company?.pause?.message).toContain('Client work portfolio');
      expect(snap.portfolio).toEqual({ id, name: 'Client work', held: true });
    }
    // Nothing new starts: a message to the CEO waits.
    const waiting = await call(`api/c/${plant}/messages`, { body: { to: 'ceo', text: 'Anything new?' } });
    const message = String(waiting.body.id);
    const until = Date.now() + 2_000;
    while (Date.now() < until) {
      expect((await viewOf(plant)).messages.find((m) => m.id === message)?.deliveredAt).toBeNull();
      await new Promise((done) => setTimeout(done, 200));
    }
    // Raised: both carry on, and the waiting message goes out.
    expect((await call(`api/portfolios/${id}`, { body: { budget: 100 } })).status).toBe(200);
    await vi.waitFor(async () => expect((await viewOf(plant)).messages.find((m) => m.id === message)?.deliveredAt).not.toBeNull(), SLOW);
    const after = await lobby();
    expect(after.portfolios.find((x) => x.id === id)?.held).toBe(false);
    expect(after.companies.find((x) => x.id === bakery)?.pause).toBeNull();
  });

  it('a company is in one portfolio at most, and the studio routes take only the hub token', { timeout: STEP_MS }, async () => {
    const twice = await call('api/portfolios', { body: { name: 'Side projects', companies: [plant] } });
    expect([twice.status, twice.body.error]).toEqual([409, 'Plant Pal is in the Client work portfolio already. Take it out there first.']);
    expect((await call('api/studio/messages', { body: { text: 'Hi' }, token: 'wrong-token-0123456789abcdefghijklmnop' })).status).toBe(401);
    expect((await call('api/portfolios', { body: { name: 'x' }, token: 'wrong-token-0123456789abcdefghijklmnop' })).status).toBe(401);
  });
});
