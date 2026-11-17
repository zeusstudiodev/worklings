// Desks on the fake Claude Code (test/fake-desk.mjs): how one opens, what it is given, delivery to a busy and a
// closed desk, resuming a session, idling out and reopening, and that nothing is left running or written.
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orgToolRules } from '../src/runtime/approvals.ts';
import { DELIVERY_RULES, SCRATCH_PATH_MARK, sweepLeakedDesks } from '../src/runtime/index.ts';
import { tempDir } from './library-kit.ts';
import { filesUnder, forStarts, isDelivered, isDesk, isSession, isTurn, until, world } from './runtime-kit.ts';

const LONG = 60_000;

describe('a desk', () => {
  it('opens with the flags, settings and environment a desk needs, and the token only in its environment', async () => {
    const w = await world({
      heartbeatMs: 200,
      scenarios: { work: [{ org: 'post_status', arguments: { text: 'Starting the menu page.' } }, { tool: 'Bash', input: { command: 'npm test' }, ms: 100 }, { say: 'Done.' }] },
    }, { rules: ['Bash(npm publish --dry-run)', 'Bash', 'mcp__gmail__send_email', 'Bash(git push origin:*)', 'Bash(npm test && git push)', 'Bash(cp evil.json .claude/settings.json)', 'mcp__gmail', 'WebFetch(domain:docs.astro.build)'] });
    try {
      w.board.deliver(w.plan('ada', { agent: 'frontend-engineer' }), { text: 'From Robin, the stakeholder: build the menu page [fake:work]', messageId: 'm-1' });
      const turn = await w.rec.waitFor(isTurn('ada'), { what: "Ada's turn" });
      expect(turn.result).toMatchObject({ ok: true, text: 'Done.', problem: null });
      // Three requests at the fake's $0.001 each: this turn's cost, not the session's running total.
      expect(turn.result.costUsd).toBeCloseTo(0.003, 10);
      expect(turn.result.contextTokens).toBeGreaterThan(20_000);
      expect(w.rec.heard.some(isDelivered('m-1'))).toBe(true);
      const session = await w.rec.waitFor(isSession('ada'));
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(turn.result.sessionId).toBe(session.sessionId);
      const states = w.rec.heard.filter(isDesk('ada')).map((e) => e.view.state);
      expect(states.filter((s, i) => s !== states[i - 1])).toEqual(['starting', 'working', 'idle']);

      const [start] = w.starts();
      const argv = start?.argv ?? [];
      const value = (f: string) => argv[argv.indexOf(f) + 1];
      expect(argv.slice(0, 6)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
      expect(value('--session-id')).toBe(session.sessionId);
      expect(argv).not.toContain('--resume');
      expect(value('--model')).toBe('haiku');
      expect(value('--permission-mode')).toBe('acceptEdits');
      expect(value('--system-prompt-snapshot')).toBe('off');
      expect(value('--agent')).toBe('frontend-engineer');
      // The scratch-folder mark is filled with the desk's own scratch folder, as the computer names it.
      const scratchFolder = start?.tmp?.TMPDIR ?? '';
      expect(value('--append-system-prompt')).toBe(`# Working at Acme\n\n## House rules\n\n- Be kind.\n\n${DELIVERY_RULES.split(SCRATCH_PATH_MARK).join(scratchFolder)}`);
      expect(value('--append-system-prompt')).not.toContain(SCRATCH_PATH_MARK);
      expect(value('--settings')?.startsWith(w.scratch)).toBe(true);
      expect(value('--mcp-config')?.startsWith(w.scratch)).toBe(true);
      expect(start?.cwd).toBe(w.project);
      expect(start?.env).toEqual({ emitSessionState: '1', disablePromptCaching: null, claudecode: false, hasToken: true, tokenLength: 64 });

      const hub = w.hub.url.replace(/\/$/, '');
      const settings = JSON.parse(start?.settings ?? '{}');
      const hook = (url: string, timeout: number) => ({ type: 'http', url, timeout, headers: { 'X-Worklings-Desk': '$WORKLINGS_DESK_TOKEN' }, allowedEnvVars: ['WORKLINGS_DESK_TOKEN'] });
      expect(settings.hooks).toEqual({
        PermissionRequest: [{ hooks: [hook(`${hub}/desk/permission`, 600)] }],
        Stop: [{ hooks: [hook(`${hub}/desk/hook`, 5)] }],
        SubagentStop: [{ hooks: [hook(`${hub}/desk/hook`, 5)] }],
      });
      // Only exact rules Claude Code can match by itself: never a whole tool or server, a prefix, a chain, or a
      // command on the project's setup. The rest stay with the policy, through the hook.
      expect(settings.permissions.allow).toEqual([...orgToolRules({ id: 'ada', level: 'worker' }), 'Bash(npm publish --dry-run)', 'mcp__gmail__send_email', 'WebFetch(domain:docs.astro.build)']);
      expect(settings.permissions.deny).toEqual(['Read(./.worklings/**)', 'Edit(./.worklings/**)', 'Write(./.worklings/**)', 'MultiEdit(./.worklings/**)', 'NotebookEdit(./.worklings/**)', 'Edit(./.worklings-shared/**)', 'Write(./.worklings-shared/**)', 'MultiEdit(./.worklings-shared/**)', 'NotebookEdit(./.worklings-shared/**)']);
      // How Claude Code and git run in the project always goes through the approval hook, for every tool that writes;
      // so do the ask-list commands, so a foreign allow rule can't carry one past the hook.
      const setupRules = ['./.claude/**', './**/.claude/**', './CLAUDE.md', './**/CLAUDE.md', './CLAUDE.local.md', './**/CLAUDE.local.md', './.mcp.json', './.git/**', './.husky/**'].flatMap(
        (path) => ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].map((tool) => `${tool}(${path})`),
      );
      expect(settings.permissions.ask).toEqual(expect.arrayContaining(setupRules));
      expect(settings.permissions.ask).toEqual(expect.arrayContaining(['Bash(git push:*)', 'PowerShell(git push:*)', 'Bash(git branch:*)', 'Bash(npm publish:*)', 'Bash(wrangler deploy:*)', 'Bash(gh pr merge:*)']));
      expect(JSON.parse(start?.mcpConfig ?? '{}')).toEqual({
        mcpServers: { org: { type: 'http', url: `${hub}/mcp`, headers: { Authorization: 'Bearer ${WORKLINGS_DESK_TOKEN}' }, alwaysLoad: true } },
      });

      // The token reached the hub from the hooks and the org tools, and was written nowhere.
      const [token, desk] = [...w.hub.tokens.entries()][0] ?? [];
      expect(desk).toMatchObject({ person: 'ada', cwd: w.project });
      expect(w.hub.calls.filter((c) => c.path === '/mcp').every((c) => c.tokenOk)).toBe(true);
      expect(w.hub.calls.some((c) => c.path === '/mcp' && c.method === 'tools/call')).toBe(true);
      expect(w.hub.calls.filter((c) => c.path === '/desk/permission')).toHaveLength(1);
      expect(w.hub.calls.filter((c) => c.path.startsWith('/desk/')).every((c) => c.tokenOk)).toBe(true);
      expect(JSON.stringify(argv)).not.toContain(token);
      for (const file of [...filesUnder(w.project), ...filesUnder(w.scratch)]) expect(readFileSync(file, 'utf8'), file).not.toContain(token);
    } finally {
      await w.close();
    }
    // The desk's folder went with it, and its token with its process.
    expect(filesUnder(w.scratch)).toEqual([]);
    expect([...w.hub.tokens.values()].every((t) => t.revoked)).toBe(true);
  });

  it("gives each person's desk its own scratch folder as TMP, TEMP and TMPDIR, and removes it with the desk", async () => {
    const w = await world({ scenarios: { scratch: [{ scratchFile: 'contrast_check.py' }, { say: 'Checked.' }] } }, { idleMs: 300 });
    const folders: string[] = [];
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: check the contrast [fake:scratch]', messageId: 'm-1' });
      const { sessionId } = await w.rec.waitFor(isSession('ada'));
      await w.rec.waitFor(isTurn('ada'));
      const [start] = w.starts();
      const argv = start?.argv ?? [];
      const scratch = start?.tmp?.TMPDIR ?? '';
      folders.push(scratch);
      // TEMP and TMPDIR name the scratch folder; TMP stays the machine's, so a desk's Git Bash can't move /tmp.
      expect(start?.tmp?.TEMP).toBe(scratch);
      expect(start?.tmp?.TMPDIR).toBe(scratch);
      expect(scratch).not.toBe('');
      expect(start?.tmp?.TMP).not.toBe(scratch);
      // A folder of its own in the desk's temporary folder, beside its settings: never the folder that holds them.
      expect(basename(scratch)).toBe('scratch');
      expect(dirname(scratch)).toBe(dirname(argv[argv.indexOf('--settings') + 1] ?? ''));
      // The hub has it with the token, for the approvals policy.
      expect([...w.hub.tokens.values()][0]).toMatchObject({ person: 'ada', cwd: w.project, scratch });
      expect(w.log().find((e) => e.event === 'scratch')?.path).toBe(join(scratch, 'contrast_check.py'));

      // An idle desk that closes takes its scratch folder along; the person's next desk gets an empty one with the same
      // name, so the prompt that tells them where it is stays what it was (the session's prompt cache depends on it).
      await w.rec.waitFor(isDesk('ada', 'closed'), { what: 'the idle desk to close' });
      expect(existsSync(dirname(scratch))).toBe(false);
      const from = w.rec.heard.length;
      w.board.deliver(w.plan('ada', { sessionId }), { text: 'From Robin: once more [fake:scratch]', messageId: 'm-2' });
      await w.rec.waitFor(isTurn('ada'), { from });
      const again = w.starts()[1]?.tmp?.TMPDIR ?? '';
      folders.push(again);
      expect(again).toBe(scratch);
      expect(existsSync(join(again, 'contrast_check.py'))).toBe(true);
    } finally {
      await w.close();
    }
    expect(folders.filter((f) => existsSync(f))).toEqual([]);
    expect(filesUnder(w.scratch)).toEqual([]);
  }, forStarts(3));

  it('sends edits of the files CLAUDE.md imports through the approval hook', async () => {
    const w = await world({ scenarios: { agents: [{ tool: 'Write', input: { file_path: 'AGENTS.md', content: '# Changed' } }, { say: 'Done.' }] } });
    try {
      writeFileSync(join(w.project, 'CLAUDE.md'), '@AGENTS.md\nSee @docs/team.md.\n');
      writeFileSync(join(w.project, 'AGENTS.md'), '# Agents\n');
      w.board.deliver(w.plan('ada'), { text: 'From Robin: update the agents notes [fake:agents]', messageId: 'm-1' });
      await w.rec.waitFor(isTurn('ada'));
      const ask = JSON.parse(w.starts()[0]?.settings ?? '{}').permissions?.ask ?? [];
      expect(ask).toEqual(expect.arrayContaining(['Edit(./AGENTS.md)', 'Write(./AGENTS.md)', 'MultiEdit(./AGENTS.md)', 'NotebookEdit(./AGENTS.md)', 'Write(./docs/team.md)', 'Write(./.claude/**)']));
      const asked = w.hub.calls.filter((c) => c.path === '/desk/permission').map((c) => String((c.body as { tool_input?: { file_path?: string } }).tool_input?.file_path ?? ''));
      expect(asked).toEqual([join(w.project, 'AGENTS.md')]);
    } finally {
      await w.close();
    }
  });

  it("runs at the effort the plan names, and at medium, never the user's own, when it names none", async () => {
    const w = await world({});
    try {
      w.board.deliver(w.plan('ada', { effort: 'high' }), { text: 'From Ada: hello', messageId: 'm-1' });
      w.board.deliver(w.plan('bo', { effort: null }), { text: 'From Ada: hello', messageId: 'm-2' });
      // Two desks starting at once, each slower for the other.
      await Promise.all(['ada', 'bo'].map((p) => w.rec.waitFor(isTurn(p), { ms: forStarts(2) })));
      const efforts = w.starts().map((s) => {
        const argv = s.argv ?? [];
        return argv.includes('--effort') ? argv[argv.indexOf('--effort') + 1] : null;
      });
      expect(efforts).toHaveLength(2);
      expect(efforts.sort()).toEqual(['high', 'medium']);
    } finally {
      await w.close();
    }
  }, forStarts(2));

  it("runs the user's own default model when the plan says inherit", async () => {
    const w = await world({});
    try {
      w.board.deliver(w.plan('bo', { model: 'inherit' }), { text: 'From Ada: hello', messageId: 'm-1' });
      await w.rec.waitFor(isTurn('bo'));
      expect(w.starts()[0]?.argv).not.toContain('--model');
    } finally {
      await w.close();
    }
  });

  it('takes a message given to a busy desk into the same turn at its next step', async () => {
    const w = await world({ heartbeatMs: 100, scenarios: { busy: [{ tool: 'Bash', input: { command: 'npm test' }, ms: 1_500 }, { say: 'Tests pass.' }] } });
    try {
      const plan = w.plan('ada');
      w.board.deliver(plan, { text: 'From Robin: run the tests [fake:busy]', messageId: 'm-1' });
      const first = await w.rec.waitFor(isDelivered('m-1'));
      await w.rec.waitFor(isDesk('ada', 'working'));
      w.board.deliver(plan, { text: 'From Robin: also update the readme', messageId: 'm-2' });
      const second = await w.rec.waitFor(isDelivered('m-2'));
      const turn = await w.rec.waitFor(isTurn('ada'));
      expect(second.at).toBeLessThanOrEqual(turn.at);
      // The first opened a turn; the second was folded into it at its next step, as Claude Code absorbs one mid-turn.
      expect(first.how).toBe('new-turn');
      expect(second.how).toBe('next-step');
      expect(turn.result.text).toBe('Fake desk took your message too: From Robin: also update the readme');
      // One process, one turn.
      expect(w.starts()).toHaveLength(1);
      await w.rec.waitFor(isDesk('ada', 'idle'));
      expect(w.rec.heard.filter(isTurn('ada'))).toHaveLength(1);
      // v0.8: a message to the warm, idle desk opens a turn of the person's, never one of Claude Code's own.
      const from = w.rec.heard.length;
      w.board.deliver(plan, { text: 'From Robin: thanks, one more check', messageId: 'm-3' });
      await w.rec.waitFor(isTurn('ada'), { from });
      expect(w.rec.heard.filter((e) => e.kind === 'own-turn')).toEqual([]);
    } finally {
      await w.close();
    }
  });

  it("resumes a person's session in a new desk, with what they knew", async () => {
    const w = await world({ scenarios: { recall: [{ recall: true }] } });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: the codeword is PLUM', messageId: 'm-1' });
      const { sessionId } = await w.rec.waitFor(isSession('ada'));
      await w.rec.waitFor(isTurn('ada'));
      await w.board.close('ada');
      await w.rec.waitFor(isDesk('ada', 'closed'));
      const from = w.rec.heard.length;
      w.board.deliver(w.plan('ada', { sessionId }), { text: 'From Robin: what was the codeword? [fake:recall]', messageId: 'm-2' });
      const turn = await w.rec.waitFor(isTurn('ada'), { from });
      expect(turn.result.text).toContain('the codeword is PLUM');
      expect(turn.result.sessionId).toBe(sessionId);
      const [, second] = w.starts();
      expect(second?.argv?.[second.argv.indexOf('--resume') + 1]).toBe(sessionId);
      expect(second?.argv).not.toContain('--session-id');
      // The session was already known: no second session event.
      expect(w.rec.heard.filter(isSession('ada'))).toHaveLength(1);
    } finally {
      await w.close();
    }
  }, forStarts(3));

  it('starts a new session when Claude Code has no record of the one the company kept', async () => {
    const w = await world({});
    try {
      const lost = '0f4ce5e5-0000-4000-8000-0000000000aa';
      w.board.deliver(w.plan('ada', { sessionId: lost }), { text: 'From Robin: hello again', messageId: 'm-1' });
      // The desk that finds no session, then the one that starts a new session.
      const turn = await w.rec.waitFor(isTurn('ada'), { ms: forStarts(2) });
      expect(turn.result.ok).toBe(true);
      const [first, second] = w.starts();
      expect(first?.argv).toContain('--resume');
      expect(second?.argv).toContain('--session-id');
      expect((await w.rec.waitFor(isSession('ada'))).sessionId).not.toBe(lost);
      expect(w.rec.heard.some(isDelivered('m-1'))).toBe(true);
    } finally {
      await w.close();
    }
  }, forStarts(2));

  it('closes when idle and reopens on the same session for the next message', async () => {
    const w = await world({}, { idleMs: 300 });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: first', messageId: 'm-1' });
      const { sessionId } = await w.rec.waitFor(isSession('ada'));
      await w.rec.waitFor(isDesk('ada', 'idle'));
      await w.rec.waitFor(isDesk('ada', 'closed'), { what: 'the idle desk to close' });
      expect(w.log().some((e) => e.event === 'stdin-closed')).toBe(true);
      expect(w.log().some((e) => e.event === 'exit' && e.code === 0)).toBe(true);
      const from = w.rec.heard.length;
      w.board.deliver(w.plan('ada', { sessionId }), { text: 'From Robin: second', messageId: 'm-2' });
      await w.rec.waitFor(isTurn('ada'), { from });
      const [, again] = w.starts();
      expect(again?.argv?.[again.argv.indexOf('--resume') + 1]).toBe(sessionId);
    } finally {
      await w.close();
    }
  }, forStarts(3));

  it('takes a new idle time while it runs: a desk idle past it closes now, one within it waits out the rest', async () => {
    let clock = 1_000_000;
    const w = await world({}, { idleMs: 60_000, now: () => clock });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: hello', messageId: 'm-1' });
      await w.rec.waitFor(isDesk('ada', 'idle'));
      clock += 99_000;
      w.board.deliver(w.plan('bo'), { text: 'From Robin: hello', messageId: 'm-2' });
      await w.rec.waitFor(isDesk('bo', 'idle'));
      // Ada has been idle 100 s and Bo 1 s; the new time is 50 s.
      clock += 1_000;
      w.board.setIdleMs(50_000);
      await w.rec.waitFor(isDesk('ada', 'closed'), { what: "Ada's desk, idle past the new time, to close" });
      expect(w.board.desks().find((d) => d.person === 'bo')?.state).toBe('idle');
      expect(w.log().filter((e) => e.event === 'stdin-closed')).toHaveLength(1);
    } finally {
      await w.close();
    }
  }, forStarts(2));

  it('waits for a background command when it closes, and counts the turn that follows it', async () => {
    const w = await world({ scenarios: { bg: [{ background: 600 }, { say: 'Started it.' }] } }, { idleMs: 200 });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: start the watcher [fake:bg]', messageId: 'm-1' });
      await w.rec.waitFor(isDesk('ada', 'closed'), { what: 'the desk to close after its background command' });
      const turns = w.rec.heard.filter(isTurn('ada'));
      expect(turns.map((t) => t.result.text)).toEqual(['Started it.', 'The background command finished.']);
      // v0.8: the turn the background command's notification opened is Claude Code's own, between the two results; the
      // turn the message opened is not.
      const order = w.rec.heard.filter((e) => (e.kind === 'turn' || e.kind === 'own-turn') && e.person === 'ada').map((e) => e.kind);
      expect(order).toEqual(['turn', 'own-turn', 'turn']);
      expect(w.log().some((e) => e.event === 'exit' && e.code === 0)).toBe(true);
    } finally {
      await w.close();
    }
  });

  it('leaves nothing running after close: the desk and what it started', async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { long: [{ tool: 'Bash', input: { command: 'npm run dev' }, ms: LONG, spawn: true }] } });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: run the dev server [fake:long]', messageId: 'm-1' });
      await w.rec.waitFor(isDelivered('m-1'));
      await until(() => w.log().some((e) => e.event === 'child'), 20_000, 'the command to start its child');
    } finally {
      // close() fails unless the desk and its child are gone.
      await w.close();
    }
    expect(filesUnder(w.scratch)).toEqual([]);
  }, forStarts(2));
});

describe('sweeping leaked desk folders', () => {
  it('removes folders whose process is gone and old, and keeps live ones, new ones and other folders', async () => {
    const base = tempDir('worklings-sweep-');
    const old = (Date.now() - 10 * 60_000) / 1000;
    const now = Date.now() / 1000;
    const make = (name: string, owner: number | null, when: number): string => {
      const folder = join(base, name);
      mkdirSync(folder, { recursive: true });
      if (owner !== null) writeFileSync(join(folder, 'owner.pid'), String(owner));
      utimesSync(folder, when, when);
      return folder;
    };
    const deadOld = make('worklings-desk-dead', 222, old);
    const liveOld = make('worklings-desk-live', 111, old);
    const deadNew = make('worklings-desk-new', 222, now);
    const ownerlessOld = make('worklings-desk-orphan', null, old);
    const ownerlessNew = make('worklings-desk-fresh', null, now);
    const notADesk = make('keep-me', null, old);

    // Only pid 111 is "alive": a dead owner and an ownerless folder, both old enough, are swept; the rest stay.
    const removed = await sweepLeakedDesks(base, { alive: (pid) => pid === 111 });
    expect(new Set(removed)).toEqual(new Set([deadOld, ownerlessOld]));
    expect(existsSync(deadOld)).toBe(false);
    expect(existsSync(ownerlessOld)).toBe(false);
    for (const kept of [liveOld, deadNew, ownerlessNew, notADesk]) expect(existsSync(kept), kept).toBe(true);
  });

  it('does nothing when the base folder is missing', async () => {
    expect(await sweepLeakedDesks(join(tempDir('worklings-sweep-'), 'missing'))).toEqual([]);
  });
});
