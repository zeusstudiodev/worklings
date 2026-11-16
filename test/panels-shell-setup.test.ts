// The lobby's first run (web/src/company/setup/): Claude Code's status as the hub says it and what the lobby makes of
// it, the consent step's lines, and the three requests, against a fake hub that answers as src/hub/setup-routes.ts does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSetup, fetchWatchPlan, installWatch } from '../web/src/company/setup/setupApi.ts';
import { asSetup, asWatchPlan, claudeNotice, removeCommand, type WatchPlan, watchLines } from '../web/src/company/setup/setupModel.ts';
import { ActionError } from '../web/src/company/types.ts';

const READY = { state: 'ready', version: '2.1.312', account: 'your Claude Max plan', perToken: false, message: 'Claude Code 2.1.312, signed in.', fix: null, link: null };
const MISSING = {
  state: 'missing', version: null, account: null, perToken: false, message: "Claude Code isn't installed, or it isn't on the PATH.",
  fix: 'Install it from https://claude.com/product/claude-code, then run claude once in a terminal to sign in.', link: 'https://claude.com/product/claude-code',
};
const SIGNED_OUT = {
  state: 'signed-out', version: '2.1.312', account: null, perToken: false, message: "Claude Code isn't signed in.", fix: 'Run claude once in a terminal and sign in.', link: 'https://example.test/sign-in',
};
const UNKNOWN = { state: 'unknown', version: '2.1.312', account: null, perToken: false, message: "Claude Code is installed, but Worklings couldn't read its sign-in.", fix: null, link: null };

const FOLDER = 'C:\\Users\\you\\Projects\\plant-pal';
const PLAN: WatchPlan = { folder: FOLDER, file: '.claude/settings.local.json', port: 7421, events: 17, installed: false, installedPort: null, gitignore: true, open: `npx worklings office "${FOLDER}"` };

describe("Claude Code's status as the lobby reads it", () => {
  it('says nothing while it is ready', () => {
    expect(claudeNotice(asSetup({ claude: READY, git: {}, checkedAt: 1 }).claude)).toBeNull();
  });

  it('links a missing one to the install page and stops Start with the reason', () => {
    const notice = claudeNotice(asSetup({ claude: MISSING, checkedAt: 1 }).claude);
    expect(notice).toMatchObject({ title: "Claude Code isn't ready", text: MISSING.message, fix: MISSING.fix, link: { href: 'https://claude.com/product/claude-code', label: 'Open the install page' } });
    expect(notice?.blocks).toBe("Claude Code isn't installed, or it isn't on the PATH. Starting waits until that's fixed.");
  });

  it('tells a signed-out one to run claude once, and stops Start', () => {
    const notice = claudeNotice(asSetup({ claude: SIGNED_OUT, checkedAt: 1 }).claude);
    expect(notice?.title).toBe("Claude Code isn't signed in");
    expect(notice?.fix).toBe('Run claude once in a terminal and sign in.');
    expect(notice?.blocks).toContain("isn't signed in");
  });

  it("warns about one it couldn't read but lets Start go ahead", () => {
    const notice = claudeNotice(asSetup({ claude: UNKNOWN, checkedAt: 1 }).claude);
    expect(notice).toMatchObject({ title: "Couldn't check Claude Code's sign-in", blocks: null, link: null, fix: null });
  });

  it("refuses an answer it can't read, which never passes for ready", () => {
    for (const body of [null, {}, { claude: {} }, { claude: { state: 'fine', message: 'x' } }, { claude: { state: 'ready' } }]) {
      expect(() => asSetup(body)).toThrow(ActionError);
    }
  });
});

describe('the consent step', () => {
  it('lists what is written, where, and that nothing else changes', () => {
    expect(watchLines(PLAN)).toEqual([
      'Adds 17 Claude Code hooks to .claude/settings.local.json, which post to port 7421 on this computer.',
      "Adds .claude/settings.local.json to the folder's .gitignore, so it isn't committed.",
      'Nothing else in the project changes.',
    ]);
  });

  it('leaves the .gitignore line out when nothing will be added, and says when hooks point elsewhere', () => {
    const lines = watchLines({ ...PLAN, gitignore: false, installedPort: 4398 });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('Its hooks post to port 4398 now; this points them at 7421.');
    expect(lines.join(' ')).not.toContain('.gitignore');
  });

  it('has nothing to add when the hooks are already there', () => {
    expect(watchLines({ ...PLAN, installed: true, installedPort: 7421 })).toEqual(['.claude/settings.local.json already reports to port 7421, so there is nothing to add.']);
  });

  it('reads the hub answer whole, and names the way to take the hooks out', () => {
    expect(asWatchPlan({ ...PLAN, gitignoreUpdated: true })).toEqual({ ...PLAN, gitignoreUpdated: true });
    expect(() => asWatchPlan({ folder: FOLDER })).toThrow(ActionError);
    expect(removeCommand(FOLDER)).toBe(`npx worklings hooks uninstall '${FOLDER}'`);
  });
});

describe('the requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const hub = (reply: (init: RequestInit) => Response) => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
      return reply(init);
    });
    return calls;
  };

  it('asks for the status, afresh when told to', async () => {
    const calls = hub(() => json(200, { claude: SIGNED_OUT, git: {}, checkedAt: 5 }));
    expect((await fetchSetup('tok')).claude.state).toBe('signed-out');
    await fetchSetup('tok', true);
    expect(calls.map((c) => c.url)).toEqual(['/api/setup', '/api/setup?fresh=1']);
  });

  it('reads the plan with a GET and writes only through a POST with consent', async () => {
    const calls = hub((init) => (init.method === 'POST' ? json(200, { ...PLAN, installed: true, gitignoreUpdated: true }) : json(200, PLAN)));
    await fetchWatchPlan('tok', FOLDER);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: `/api/watch?folder=${encodeURIComponent(FOLDER)}` });
    const done = await installWatch('tok', FOLDER, 7421);
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/watch', body: { folder: FOLDER, consent: true, port: 7421 } });
    expect(done.installed).toBe(true);
    expect(done.gitignoreUpdated).toBe(true);
  });

  it("shows the hub's own sentence for a refusal", async () => {
    hub(() => json(400, { error: "That folder doesn't exist. Pick the project's folder.", code: 'missing' }));
    await expect(fetchWatchPlan(null, FOLDER)).rejects.toMatchObject({ message: "That folder doesn't exist. Pick the project's folder.", code: 'missing' });
  });
});
