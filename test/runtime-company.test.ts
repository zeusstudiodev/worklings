// The switchboard under a real company (src/company/) with the fake Claude Code: the contract between the two, end
// to end inside one process. The hub's own routes are the QA stream's; here a fake hub stands in for them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeskControl, DeskEvents } from '../src/core/company.ts';
import { createCompany, openCompany } from '../src/company/index.ts';
import { createSwitchboard } from '../src/runtime/index.ts';
import { fakeGit, fakeOrg, KEY, newProject } from './company-kit.ts';
import { tempDir } from './library-kit.ts';
import { alive, FAKE_DESK, fakeHub, type FakeLogEntry, forStarts, until } from './runtime-kit.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function setup() {
  const dir = tempDir('worklings-runtime-company-');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  const logFile = join(dir, 'desk.jsonl');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify({}));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE'].includes(k.toUpperCase()))),
    WORKLINGS_CLAUDE: FAKE_DESK,
    FAKE_DESK_SCRIPT: scriptFile,
    FAKE_DESK_LOG: logFile,
    FAKE_DESK_SESSIONS: join(dir, 'sessions'),
  };
  const hub = await fakeHub();
  const root = newProject();
  const boards: DeskControl[] = [];
  const deps = {
    key: KEY,
    org: fakeOrg(),
    git: fakeGit(),
    warn: () => {},
    desks: (events: DeskEvents, companyId: string) => {
      const board = createSwitchboard({ companyId, root, hub, events, maxDesks: 4, idleMs: 60_000, env, claude: FAKE_DESK, scratch });
      boards.push(board);
      return board;
    },
  };
  const log = (): FakeLogEntry[] => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry) : []);
  const gone = async () => {
    const pids = log().flatMap((e) => (e.event === 'start' ? [e.pid] : []));
    await until(() => pids.every((pid) => !alive(pid)), 10_000, 'the desks to be gone');
  };
  return { root, hub, deps, log, gone };
}

describe('the switchboard under a real company', () => {
  it("delivers a new company's opening turn to its CEO, and the company records the delivery, the session and the cost", async () => {
    const s = await setup();
    const company = createCompany({ ...s.deps, root: s.root, prompt: 'A bilingual café website with pickup orders.', stakeholder: 'Robin' });
    try {
      await until(() => company.view().messages.some((m) => m.to === 'ceo' && m.deliveredAt !== null), 30_000, "the CEO's opening turn to be delivered");
      await until(() => (company.view().people.find((p) => p.id === 'ceo')?.cost ?? 0) > 0, 30_000, "the CEO's turn to be counted");
      const ceo = company.view().people.find((p) => p.id === 'ceo');
      expect(ceo?.desk.sessionId).toMatch(UUID);
      expect(ceo?.desk.state).toBe('idle');
      expect(s.log().find((e) => e.event === 'start')?.argv).toContain('--session-id');
      const said = company.say('ceo', 'Make the menu bilingual.');
      await until(() => company.view().messages.find((m) => m.id === said.id)?.deliveredAt != null, 30_000, 'the message to reach the CEO');
      expect(s.log().filter((e) => e.event === 'start')).toHaveLength(1);
    } finally {
      await company.close();
      await s.hub.close();
      await s.gone();
    }
    // A desk start, and the taskkill that closes it.
  }, forStarts(2));

  it('resumes after a restart: a message held while resting goes out once, on the same session', async () => {
    const s = await setup();
    const first = createCompany({ ...s.deps, root: s.root, prompt: 'A cozy iPhone game.', stakeholder: 'Robin' });
    let second: ReturnType<typeof openCompany> | null = null;
    try {
      await until(() => first.view().messages.some((m) => m.to === 'ceo' && m.deliveredAt !== null), 30_000, "the CEO's opening turn");
      await until(() => first.view().people.find((p) => p.id === 'ceo')?.desk.sessionId != null, 30_000, "the CEO's session");
      const session = first.view().people.find((p) => p.id === 'ceo')?.desk.sessionId;
      first.pause();
      const held = first.say('ceo', 'Before you go on: the game is for kids.');
      expect(first.view().messages.find((m) => m.id === held.id)?.deliveredAt).toBeNull();
      await first.close();
      await s.gone();

      second = openCompany({ ...s.deps, root: s.root });
      second.resume();
      await until(() => second?.view().messages.find((m) => m.id === held.id)?.deliveredAt != null, 30_000, 'the held message after the restart');
      const starts = s.log().filter((e) => e.event === 'start');
      expect(starts).toHaveLength(2);
      const argv = starts[1]?.argv ?? [];
      expect(argv[argv.indexOf('--resume') + 1]).toBe(session);
      // It reached the CEO once: one user line with its words across both desks.
      const lines = s.log().filter((e) => e.event === 'line' && JSON.stringify(e.line).includes('the game is for kids'));
      expect(lines).toHaveLength(1);
    } finally {
      await second?.close();
      await s.hub.close();
      await s.gone();
    }
    // Two desk starts, one before the restart and one after, and the two taskkills that close them.
  }, forStarts(4));
});
