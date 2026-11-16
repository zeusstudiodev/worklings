import { describe, expect, it } from 'vitest';
import { askedQuestion, closingQuestion, describeTool, displayPath, normalizeHook, toolPhrase } from '../src/core/events.ts';
import { hookPayloads, SESSION, SUBAGENT } from './fixtures.ts';

describe('normalizeHook on a real 2.1.312 session', () => {
  const events = hookPayloads().map((p, i) => normalizeHook(p, 1000 + i));

  it('maps every captured payload to the expected event kind', () => {
    expect(events.map((e) => e?.kind ?? null)).toEqual([
      'prompt', 'tool-start', 'tool-end', null, 'tool-start', 'subagent-start', 'tool-end', null,
      'tool-start', 'tool-end', null, 'turn-end', 'subagent-stop', 'prompt', 'tool-start', 'tool-start',
      'tool-end', 'tool-end', null, 'turn-end', 'session-end',
    ]);
    expect(events.every((e) => e === null || e.sessionId === SESSION)).toBe(true);
  });

  it('describes the write with a project-relative path and records the file', () => {
    expect(events[1]).toMatchObject({ kind: 'tool-start', tool: 'Write', target: 'notes.txt', cwd: '/project' });
    expect(events[2]).toMatchObject({ kind: 'tool-end', tool: 'Write', ok: true, file: 'notes.txt', durationMs: 28 });
  });

  it('links the Agent call to the subagent it spawns', () => {
    expect(events[4]).toMatchObject({ kind: 'tool-start', tool: 'Agent', spawn: { agentType: 'reviewer' } });
    expect(events[5]).toEqual(expect.objectContaining({ kind: 'subagent-start', agentId: SUBAGENT, agentType: 'reviewer' }));
  });

  it('attributes tool calls inside the subagent to it', () => {
    expect(events[8]).toMatchObject({ kind: 'tool-start', tool: 'Read', agentId: SUBAGENT, agentType: 'reviewer', target: 'notes.txt' });
  });

  it('keeps the subagent transcript path and last message', () => {
    expect(events[12]).toMatchObject({
      kind: 'subagent-stop',
      agentTranscriptPath: `~/.claude/projects/-project/${SESSION}/subagents/agent-${SUBAGENT}.jsonl`,
      lastMessage: 'The file `notes.txt` contains one line: `hello`.',
    });
  });

  it('recognises background-task notifications', () => {
    expect(events[0]).toMatchObject({ kind: 'prompt', notification: false });
    expect(events[13]).toMatchObject({ kind: 'prompt', notification: true, text: 'A background task finished' });
  });
});

describe('normalizeHook for events documented but not captured', () => {
  const base = { session_id: 's1', cwd: '/p' };

  it('reads permission requests and notifications that need the user', () => {
    expect(normalizeHook({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, 1))
      .toMatchObject({ kind: 'permission', tool: 'Bash', target: 'rm' });
    expect(normalizeHook({ ...base, hook_event_name: 'Notification', message: 'Claude needs your permission', notification_type: 'permission_prompt' }, 1))
      .toMatchObject({ kind: 'notice', needsYou: true });
    // A session that finished its turn and waits for the next prompt isn't blocked on anyone.
    expect(normalizeHook({ ...base, hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }, 1))
      .toMatchObject({ kind: 'notice', needsYou: false });
    expect(normalizeHook({ ...base, hook_event_name: 'Notification', message: 'Signed in', notification_type: 'auth_success' }, 1))
      .toMatchObject({ kind: 'notice', needsYou: false });
  });

  it('reads tool failures, interrupts and failed turns', () => {
    expect(normalizeHook({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't', error: 'Exit code 1\nboom' }, 1))
      .toMatchObject({ kind: 'tool-end', ok: false, error: 'Exit code 1 boom' });
    expect(normalizeHook({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't', error: 'x', is_interrupt: true }, 1))
      .toMatchObject({ kind: 'tool-end', ok: false, error: 'Interrupted' });
    expect(normalizeHook({ ...base, hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'Rate limited' }, 1))
      .toMatchObject({ kind: 'turn-end', failed: true, lastMessage: 'Rate limited' });
  });

  it('reads agent-team tasks and idle teammates', () => {
    expect(normalizeHook({ ...base, hook_event_name: 'TaskCreated', task_id: '7', task_subject: 'Write the parser', teammate_name: 'backend' }, 1))
      .toMatchObject({ kind: 'task', taskId: '7', title: 'Write the parser', status: 'open', owner: 'backend' });
    expect(normalizeHook({ ...base, hook_event_name: 'TaskCompleted', task_id: '7', task_subject: 'Write the parser' }, 1))
      .toMatchObject({ kind: 'task', status: 'done' });
    expect(normalizeHook({ ...base, hook_event_name: 'TeammateIdle', teammate_name: 'backend' }, 1)).toMatchObject({ kind: 'teammate-idle', teammate: 'backend' });
  });

  it('reads a SendMessage that continues a subagent as a new brief for it, masked', () => {
    const token = `ghp_${'Ab1'.repeat(12)}`;
    const send = (input: Record<string, unknown>) => normalizeHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't', tool_input: input }, 1);
    expect(send({ to: 'a4e964624f302ccfe', summary: 'Re-check the security fixes', message: 'Please re-check…' }))
      .toMatchObject({ kind: 'tool-start', tool: 'SendMessage', brief: { agentId: 'a4e964624f302ccfe', description: 'Re-check the security fixes' } });
    expect(send({ to: 'a4e964624f302ccfe', summary: `Rotate ${token}` })).toMatchObject({ brief: { description: 'Rotate [redacted]' } });
    expect(send({ to: 'a4e964624f302ccfe', message: 'Now check   the\nfixes' })).toMatchObject({ brief: { description: 'Now check the fixes' } });
    for (const to of ['--debug', '../agents', '__proto__', '', 42]) expect(send({ to, summary: 'x' })).not.toHaveProperty('brief');
    expect(normalizeHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't', tool_input: { to: 'a1', summary: 'x' } }, 1)).not.toHaveProperty('brief');
  });

  it('ignores junk and unknown events', () => {
    expect(normalizeHook(null, 1)).toBeNull();
    expect(normalizeHook({ hook_event_name: 'PreToolUse' }, 1)).toBeNull();
    expect(normalizeHook({ ...base, hook_event_name: 'FileChanged' }, 1)).toBeNull();
  });

  it("drops events whose ids aren't Claude Code ids", () => {
    expect(normalizeHook({ ...base, session_id: '__proto__', hook_event_name: 'Stop' }, 1)).toBeNull();
    expect(normalizeHook({ ...base, session_id: 'a b', hook_event_name: 'Stop' }, 1)).toBeNull();
    expect(normalizeHook({ ...base, hook_event_name: 'SubagentStart', agent_id: 'constructor', agent_type: 'x' }, 1)).toBeNull();
    expect(normalizeHook({ ...base, hook_event_name: 'TaskCreated', task_id: '__proto__', task_subject: 'x' }, 1)).toBeNull();
  });
});

describe('describeTool', () => {
  it.each([
    ['Bash', { command: 'npm ci', description: 'Install dependencies' }, 'Install dependencies'],
    ['Bash', { command: 'npm   test\n  --silent' }, 'npm test'],
    ['Grep', { pattern: 'TODO' }, 'TODO'],
    ['WebFetch', { url: 'https://code.claude.com/docs/en/hooks' }, 'code.claude.com/docs/en/hooks'],
    ['Agent', { subagent_type: 'qa-engineer', description: 'Run the e2e suite' }, 'qa-engineer: Run the e2e suite'],
    ['Skill', { skill: 'design-review' }, 'design-review'],
    ['mcp__github__create_pull_request', {}, 'github › create pull request'],
    ['SomethingNew', { x: 1 }, ''],
  ])('%s', (tool, input, expected) => {
    expect(describeTool(tool, input)).toBe(expected);
  });

  it('shows a command without a description as its program and plain words, never its values', () => {
    expect(describeTool('Bash', { command: 'export ANTHROPIC_API_KEY=sk-ant-api03-abcdef' })).toBe('export');
    expect(describeTool('Bash', { command: 'API_KEY=secret npm run deploy -- --prod' })).toBe('npm run deploy');
    expect(describeTool('Bash', { command: 'curl -H "Authorization: Bearer abc" https://api.example.com' })).toBe('curl');
    expect(describeTool('Bash', { command: 'mytool sk-ant-api03-0123456789abcdefghij' })).toBe('mytool');
    expect(describeTool('PowerShell', { command: 'Get-ChildItem -Recurse' })).toBe('Get-ChildItem');
  });

  it('shortens paths outside the project', () => {
    expect(displayPath('C:\\Users\\me\\proj\\src\\app.ts', 'C:\\Users\\me\\proj')).toBe('src/app.ts');
    expect(displayPath('/etc/nginx/sites/a/b.conf', '/p')).toBe('…/sites/a/b.conf');
  });
});

describe('toolPhrase', () => {
  it.each([
    ['Read', 'notes.txt', 'Reads notes.txt', 'read notes.txt'],
    ['Bash', 'npm test', 'Runs npm test', 'run npm test'],
    ['Bash', 'Install dependencies', 'Install dependencies', 'install dependencies'],
    ['Grep', 'TODO', 'Searches the code for TODO', 'search the code for TODO'],
    ['Agent', 'qa-engineer: Run the suite', 'Briefs qa-engineer: Run the suite', 'brief qa-engineer: Run the suite'],
    ['Skill', 'code-gate', 'Follows the code-gate playbook', 'follow the code-gate playbook'],
    ['TodoWrite', 'updating the plan', 'Updates the plan', 'update the plan'],
    ['mcp__github__create_pull_request', '', 'Uses github: create pull request', 'use github: create pull request'],
    ['Teleport', 'mars', 'Uses Teleport: mars', 'use Teleport: mars'],
  ])('%s %s', (tool, target, third, infinitive) => {
    expect(toolPhrase(tool, target)).toBe(third);
    expect(toolPhrase(tool, target, 'infinitive')).toBe(infinitive);
  });
});

describe('questions waiting on someone', () => {
  it.each([
    ['Done. Want me to run the end-to-end suite too?', 'Want me to run the end-to-end suite too?'],
    ['Built it.\n\n**Should I also update the docs?**', 'Should I also update the docs?'],
    ['Which one: the parser or the importer?"', 'Which one: the parser or the importer?'],
    ['All checks pass.', undefined],
    ['Is it fixed? Yes, all green now.', undefined],
  ])('finds the closing question in %j', (message, question) => {
    expect(closingQuestion(message)).toBe(question);
  });

  it('keeps the closing question of a report longer than the 200 characters the report keeps', () => {
    const long = `${'The importer reads both formats and the tests cover each. '.repeat(6)}Shall I delete the old parser?`;
    const e = normalizeHook({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', agent_type: 'qa-engineer', last_assistant_message: long }, 1);
    expect(e).toMatchObject({ kind: 'subagent-stop', question: 'Shall I delete the old parser?' });
    expect(e?.kind === 'subagent-stop' && e.lastMessage?.length).toBeLessThanOrEqual(200);
  });

  it('reads the question an AskUserQuestion call puts to the person', () => {
    const input = { questions: [{ question: 'Which chart library should I use?', header: 'Charts', options: [{ label: 'Recharts' }], multiSelect: false }] };
    expect(normalizeHook({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'AskUserQuestion', tool_input: input, tool_use_id: 't' }, 1))
      .toMatchObject({ kind: 'tool-start', tool: 'AskUserQuestion', ask: 'Which chart library should I use?' });
    expect(askedQuestion({ questions: 'nope' })).toBeUndefined();
    expect(askedQuestion({ questions: [{ header: 'No question' }] })).toBeUndefined();
  });
});
