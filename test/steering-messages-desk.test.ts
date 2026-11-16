// A message to a room through a real company and its real switchboard, with the fake Claude Code at every desk
// (test/fake-desk.mjs): a busy desk takes its copy at its next step, idle ones open a turn for theirs, each turn names
// the room, and the company keeps how each copy was taken, as the switchboard reports it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type DeskEvents, STAKEHOLDER } from '../src/core/company.ts';
import { createCompany } from '../src/company/index.ts';
import { createSwitchboard } from '../src/runtime/index.ts';
import { fakeGit, fakeOrg, KEY, newProject, proposal } from './company-kit.ts';
import { tempDir } from './library-kit.ts';
import { alive, FAKE_DESK, fakeHub, type FakeLogEntry, until } from './runtime-kit.ts';

async function setup(script: object) {
  const dir = tempDir('worklings-steering-desk-');
  const scratch = join(dir, 'scratch');
  mkdirSync(scratch);
  const logFile = join(dir, 'desk.jsonl');
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(script));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['WORKLINGS_CLAUDE', 'HEADCOUNT_CLAUDE'].includes(k.toUpperCase()))),
    WORKLINGS_CLAUDE: FAKE_DESK,
    FAKE_DESK_SCRIPT: scriptFile,
    FAKE_DESK_LOG: logFile,
    FAKE_DESK_SESSIONS: join(dir, 'sessions'),
  };
  const hub = await fakeHub();
  const root = newProject();
  const deps = {
    key: KEY,
    org: fakeOrg(),
    git: fakeGit(),
    warn: () => {},
    desks: (events: DeskEvents, companyId: string) => createSwitchboard({ companyId, root, hub, events, maxDesks: 8, idleMs: 60_000, env, claude: FAKE_DESK, scratch }),
  };
  const log = (): FakeLogEntry[] => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry) : []);
  const gone = async () => {
    const pids = log().flatMap((e) => (e.event === 'start' ? [e.pid] : []));
    await until(() => pids.every((pid) => !alive(pid)), 10_000, 'the desks to be gone');
  };
  return { root, hub, deps, log, gone };
}

describe('a message to a room at real desks', () => {
  it('reaches a busy desk at its next step and idle ones as new turns, each naming the room, and the company keeps how', async () => {
    // Ada's first turn runs four seconds, so the room's message reaches her desk while she is at work.
    const s = await setup({ scenarios: { busy: [{ wait: 4_000 }, { say: 'Looked at the menu.' }] } });
    const company = createCompany({ ...s.deps, root: s.root, prompt: 'A bilingual café website with pickup orders.', stakeholder: 'Robin' });
    try {
      const proposed = company.proposeOrg('ceo', proposal());
      if (!proposed.ok) throw new Error(proposed.errors.join('; '));
      company.start();
      await company.idle();
      const busy = company.say('head-of-design', '[fake:busy] Have a look at the menu.');
      await until(() => company.view().messages.find((m) => m.id === busy.id)?.deliveredAt != null, 30_000, "Ada's long turn to start");

      const copies = company.send(STAKEHOLDER, { to: { kind: 'room', id: 'design' }, text: 'Make the palette darker.', for: [] });
      const stored = (id: string) => company.view().messages.find((m) => m.id === id);
      await until(() => copies.every((c) => stored(c.id)?.deliveredAt != null), 30_000, 'every copy to arrive');
      expect(Object.fromEntries(copies.map((c) => [c.to, stored(c.id)?.deliveredHow]))).toEqual({ 'head-of-design': 'next-step', 'ui-designer': 'new-turn', 'ux-designer': 'new-turn' });

      // Each person's own desk read their copy as a user turn naming the room and the copy's id.
      const entries = s.log();
      const whoseDesk = (pid: number) => entries.find((e) => e.event === 'start' && e.pid === pid)?.argv?.join(' ') ?? '';
      const intro: Record<string, string> = { 'head-of-design': 'Ada, head of design', 'ui-designer': 'Kai, UI designer', 'ux-designer': 'Lea, UX designer' };
      for (const c of copies) {
        const read = entries.filter((e) => e.event === 'line' && JSON.stringify(e.line).includes(`From Robin, the stakeholder, to the design room (message ${c.id})`));
        expect(read).toHaveLength(1);
        expect(whoseDesk(read[0]?.pid ?? -1)).toContain(`You are ${intro[c.to]}`);
      }
    } finally {
      await company.close();
      await s.hub.close();
      await s.gone();
    }
  });
});
