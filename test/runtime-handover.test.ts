// v0.2: what the runtime does for a handover. The switchboard starts a new session when the company drops a person's
// (and only then), and the approvals policy lets a person use their own handover notes and nothing else under
// .worklings. Desks run on the fake Claude Code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPermission, type PermissionVerdict, type PolicyOptions } from '../src/runtime/approvals.ts';
import { tempDir } from './library-kit.ts';
import { forStarts, isDesk, isSession, isTurn, world } from './runtime-kit.ts';

describe('a fresh desk after a handover', () => {
  it('starts a new session when the company drops the old one, and resumes it when it does not', async () => {
    const w = await world({});
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: first', messageId: 'm-1' });
      const { sessionId } = await w.rec.waitFor(isSession('ada'));
      await w.rec.waitFor(isTurn('ada'));
      await w.board.close('ada');
      await w.rec.waitFor(isDesk('ada', 'closed'));

      // The company kept the session: the next desk resumes it.
      let from = w.rec.heard.length;
      w.board.deliver(w.plan('ada', { sessionId }), { text: 'From Robin: second', messageId: 'm-2' });
      await w.rec.waitFor(isTurn('ada'), { from });
      await w.board.close('ada');
      await w.rec.waitFor(isDesk('ada', 'closed'), { from });

      // The company dropped it at a handover: a new session, though the seat remembers one.
      from = w.rec.heard.length;
      w.board.deliver(w.plan('ada', { sessionId: null, fresh: true }), { text: 'From Robin: third', messageId: 'm-3' });
      await w.rec.waitFor(isTurn('ada'), { from });
      const [, resumed, fresh] = w.starts();
      expect(resumed?.argv?.[resumed.argv.indexOf('--resume') + 1]).toBe(sessionId);
      expect(fresh?.argv).not.toContain('--resume');
      const next = fresh?.argv?.[(fresh.argv.indexOf('--session-id') ?? -2) + 1];
      expect(next).toMatch(/^[0-9a-f-]{36}$/);
      expect(next).not.toBe(sessionId);
      // The company hears the new session, so it records it.
      expect((await w.rec.waitFor(isSession('ada'), { from })).sessionId).toBe(next);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it('keeps its own session when the plan carries none and does not say it is fresh', async () => {
    const w = await world({});
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: first', messageId: 'm-1' });
      const { sessionId } = await w.rec.waitFor(isSession('ada'));
      await w.rec.waitFor(isTurn('ada'));
      await w.board.close('ada');
      await w.rec.waitFor(isDesk('ada', 'closed'));
      const from = w.rec.heard.length;
      w.board.deliver(w.plan('ada', { sessionId: null }), { text: 'From Robin: second', messageId: 'm-2' });
      await w.rec.waitFor(isTurn('ada'), { from });
      const [, again] = w.starts();
      expect(again?.argv?.[again.argv.indexOf('--resume') + 1]).toBe(sessionId);
    } finally {
      await w.close();
    }
  }, forStarts(3));
});

describe("a person's handover notes under the approvals policy", () => {
  let root = '';
  let home = '';
  let tmp = '';
  let scratch = '';
  beforeAll(() => {
    const dir = tempDir('worklings-handover-policy-');
    root = join(dir, 'cafe');
    home = join(dir, 'home');
    tmp = join(dir, 'tmp');
    scratch = join(tmp, 'desk-ui-designer');
    for (const d of [join(root, '.worklings', 'handover'), join(root, 'src'), home, scratch]) mkdirSync(d, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cafe', scripts: { test: 'vitest run' } }));
  });
  const policy = (o: Partial<PolicyOptions> = {}): PolicyOptions => ({ root, branch: 'worklings/cafe', rules: [], home, tmp, scratch, person: 'ui-designer', ...o });
  const run = (name: string, input: Record<string, unknown>, o?: Partial<PolicyOptions>): PermissionVerdict =>
    classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: name, tool_input: input, cwd: root }, policy(o));
  const notes = (person: string) => join(root, '.worklings', 'handover', `${person}.md`);

  it('lets a person write and read their own notes, from the project or from a worktree', () => {
    expect(run('Write', { file_path: notes('ui-designer'), content: 'x' }).verdict).toBe('allow');
    expect(run('Edit', { file_path: notes('ui-designer'), old_string: 'a', new_string: 'b' }).verdict).toBe('allow');
    expect(run('Read', { file_path: notes('ui-designer') }).verdict).toBe('allow');
    expect(run('Write', { file_path: notes('ui-designer'), content: 'x' }, { cwd: join(tmp, 'elsewhere') }).verdict).toBe('allow');
  });

  it("refuses someone else's notes, the rest of .worklings and a notes path that leads out of the folder", () => {
    for (const file of [notes('frontend-engineer'), join(root, '.worklings', 'events.jsonl'), join(root, '.worklings', 'handover', '..', 'company.json'), join(root, '.worklings', 'handover', 'ui-designer.md.bak')]) {
      expect(run('Write', { file_path: file, content: 'x' }).verdict).toBe('deny');
      expect(run('Read', { file_path: file }).verdict).toBe('deny');
    }
    // Without a person, nothing under .worklings is open.
    expect(run('Write', { file_path: notes('ui-designer'), content: 'x' }, { person: null }).verdict).toBe('deny');
  });

  it('lets a person read long output from a file in their scratch folder, which the house rules tell them to do', () => {
    const v = classifyPermission(
      { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test > "$TMPDIR/test.log" 2>&1; tail -n 40 "$TMPDIR/test.log"' }, cwd: root },
      policy(),
    );
    expect(v.verdict).toBe('allow');
  });
});
