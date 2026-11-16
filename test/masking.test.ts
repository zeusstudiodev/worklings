import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closingQuestion, normalizeHook, type OfficeEvent, safeId, shownText } from '../src/core/events.ts';
import { personRow, plainText } from '../src/core/now.ts';
import { type AgentState, apply, emptyOffice } from '../src/core/office.ts';
import { redactSecrets } from '../src/core/redact.ts';
import { replayEvents } from '../src/core/transcript.ts';
import { listSessions, sessionEvents } from '../src/server/replay.ts';
import { tempDir } from './library-kit.ts';

// Synthetic credentials in the shapes the masker knows: a GitHub token and an Anthropic key.
const TOKEN = `ghp_${'Ab1'.repeat(12)}`;
const KEY = `sk-ant-api03-${'Xy9'.repeat(10)}`;
const base = { session_id: 's1', cwd: '/project' };

function hook(payload: Record<string, unknown>): OfficeEvent {
  const event = normalizeHook({ ...base, ...payload }, 1);
  if (!event) throw new Error('The office dropped the hook.');
  return event;
}

/** Every string an event will show, so a test can say none of them leaks. */
const shownStrings = (event: unknown): string => JSON.stringify(event);

describe('free text from hooks reaches the screen masked', () => {
  it("masks a subagent's report and the question it ends with", () => {
    const e = hook({
      hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'qa-engineer',
      last_assistant_message: `Done: the deploy uses ${TOKEN}. Should I rotate ${KEY} too?`,
    });
    expect(e).toMatchObject({ kind: 'subagent-stop', lastMessage: 'Done: the deploy uses [redacted]. Should I rotate [redacted] too?', question: 'Should I rotate [redacted] too?' });
    expect(shownStrings(e)).not.toMatch(/ghp_|sk-ant-/);
  });

  it("masks the lead's last word and a question put to the person", () => {
    const stop = hook({ hook_event_name: 'Stop', last_assistant_message: `Pushed with ${TOKEN}. Want me to open the PR?` });
    expect(stop).toMatchObject({ lastMessage: 'Pushed with [redacted]. Want me to open the PR?', question: 'Want me to open the PR?' });
    const ask = hook({
      hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 't1',
      tool_input: { questions: [{ question: `Should I use ${KEY} for the staging deploy?` }] },
    });
    expect(ask).toMatchObject({ kind: 'tool-start', ask: 'Should I use [redacted] for the staging deploy?' });
  });

  it('masks an error and what a command is for', () => {
    const failed = hook({
      hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'curl' },
      error: `curl: (22) 401 for Authorization: Bearer ${TOKEN}`,
    });
    expect(failed).toMatchObject({ kind: 'tool-end', ok: false, error: 'curl: (22) 401 for Authorization: Bearer [redacted]' });
    const bash = hook({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't2',
      tool_input: { command: `GITHUB_TOKEN=${TOKEN} git push`, description: `Push with GITHUB_TOKEN=${TOKEN}` },
    });
    expect(bash).toMatchObject({ kind: 'tool-start', target: 'Push with GITHUB_TOKEN=[redacted]' });
    const permission = hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { description: `Use ${KEY}` } });
    expect(permission).toMatchObject({ kind: 'permission', target: 'Use [redacted]' });
  });

  it("masks prompts, notices, task titles and a brief's description", () => {
    const events = [
      hook({ hook_event_name: 'UserPromptSubmit', prompt: `Use this key: ${KEY} and deploy` }),
      hook({ hook_event_name: 'Notification', message: `Claude needs your permission to use ${TOKEN}`, notification_type: 'permission_prompt' }),
      hook({ hook_event_name: 'TaskCreated', task_id: '1', task_subject: `Rotate ${TOKEN}` }),
      hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't3', tool_input: { subagent_type: 'qa-engineer', description: `Check ${KEY}` } }),
    ];
    expect(events.map(shownStrings).join('\n')).not.toMatch(/ghp_|sk-ant-/);
    expect(events.map(shownStrings).join('\n').match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('masks a value Markdown put in backticks, in a report, a question and a brief', () => {
    const secret = 'token: `a1b2c3d4e5f6`';
    const events = [
      hook({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'qa-engineer', last_assistant_message: `Rotated it, the new ${secret}. Keep the old ${secret}?` }),
      hook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 't1', tool_input: { questions: [{ question: `Use ${secret} for staging?` }] } }),
      hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't2', tool_input: { subagent_type: 'qa-engineer', description: `Check the ${secret}` } }),
    ];
    expect(events[0]).toMatchObject({ lastMessage: 'Rotated it, the new token: `[redacted]`. Keep the old token: `[redacted]`?', question: 'Keep the old token: `[redacted]`?' });
    expect(events[1]).toMatchObject({ ask: 'Use token: `[redacted]` for staging?' });
    expect(events[2]).toMatchObject({ spawn: { description: 'Check the token: `[redacted]`' } });
    expect(events.map(shownStrings).join('\n')).not.toContain('a1b2c3d4e5f6');
  });

  it('masks a secret whose name Markdown put in emphasis, as it arrives and on screen', () => {
    const report = 'Found the config:\n- **DB_PASSWORD**: `s3cr3t-pass-2024`\n*API_KEY*: abc123def456\n**password**: hunter2x9';
    const e = hook({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'qa-engineer', last_assistant_message: report });
    expect(e).toMatchObject({ lastMessage: 'Found the config: - **DB_PASSWORD**: `[redacted]` *API_KEY*: [redacted] **password**: [redacted]' });
    expect(shownStrings(e)).not.toMatch(/s3cr3t|abc123def456|hunter2x9/);

    // On screen the emphasis goes, the names keep their underscores, and the values stay masked.
    const state = emptyOffice();
    apply(state, e);
    const agents: AgentState[] = Object.values(state.agents);
    const qa = agents[0];
    if (!qa) throw new Error('The report made nobody.');
    const row = personRow({ agents }, qa, 2);
    expect(row.result).toBe('Found the config: - DB_PASSWORD: [redacted] API_KEY: [redacted] password: [redacted]');
    // Text that skipped masking on the way in is masked once its Markdown is gone.
    for (const line of report.split('\n').slice(1)) expect(plainText(line)).not.toMatch(/s3cr3t|abc123def456|hunter2x9/);
    expect(plainText('- **DB_PASSWORD**: `s3cr3t-pass-2024`')).toBe('- DB_PASSWORD: [redacted]');
    expect(plainText('*API_KEY*: abc123def456')).toBe('API_KEY: [redacted]');
  });

  it('leaves emphasis alone when the name says nothing secret, or the value is too short to be one', () => {
    for (const text of ['**Note**: read the docs first', '*token*: abc', '**Status**: ok123']) expect(redactSecrets(text)).toBe(text);
    expect(plainText('**_both_** and the `__init__` hook and snake_case_names')).toBe('both and the __init__ hook and snake_case_names');
  });

  it('never shows half of a secret where the text is cut, even behind a long run of spaces', () => {
    for (const text of [`${'word '.repeat(37)}${TOKEN}`, `${' '.repeat(1_995)}${TOKEN} and more`, `${'x'.repeat(190)} ${TOKEN}`]) {
      const shown = shownText(text, 200);
      expect(shown).not.toMatch(/ghp_|Ab1Ab1/);
    }
  });

  it('drops ids that could pass for a flag or a path', () => {
    for (const id of ['--debug', '-r', '..', '.hidden', ':x']) expect(safeId(id)).toBeUndefined();
    for (const id of ['b0581371-e091-4b14-9a83-550be0bb1ac8', 'acc52a8892c7c742e', '42', 'demo-session', 'a.b:c-d']) expect(safeId(id)).toBe(id);
    expect(normalizeHook({ hook_event_name: 'UserPromptSubmit', session_id: '--debug', prompt: 'hi', cwd: '/project' }, 1)).toBeNull();
  });
});

describe('free text from transcripts reaches the screen masked', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 4, 12, 0, s)).toISOString();
  const line = (entry: Record<string, unknown>) => JSON.stringify(entry);

  it("masks a replay's prompts and the lead's last word", () => {
    const text = [
      line({ type: 'user', timestamp: at(1), message: { role: 'user', content: `Deploy with ${KEY}` } }),
      line({ type: 'assistant', timestamp: at(2), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: `Deployed with ${TOKEN}. Anything else?` }] } }),
    ].join('\n');
    const events = replayEvents(text, { sessionId: 's1', cwd: '/project', fallbackTime: 0 });
    expect(events.find((e) => e.kind === 'prompt')).toMatchObject({ text: 'Deploy with [redacted]' });
    expect(events.find((e) => e.kind === 'turn-end')).toMatchObject({ lastMessage: 'Deployed with [redacted]. Anything else?', question: 'Anything else?' });
    expect(events.map(shownStrings).join('\n')).not.toMatch(/ghp_|sk-ant-/);
  });

  it("masks a replayed subagent's report and the session's title", () => {
    const root = '/project';
    const home = tempDir('worklings-claude-');
    const dir = join(home, 'projects', '-project');
    const subDir = join(dir, 's1', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(dir, 's1.jsonl'), [
      line({ type: 'user', timestamp: at(1), message: { role: 'user', content: `Rotate ${KEY} please` } }),
      line({ type: 'assistant', timestamp: at(2), message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } }),
    ].join('\n'));
    writeFileSync(join(subDir, 'agent-a1.jsonl'), [
      line({ type: 'user', timestamp: at(3), isSidechain: true, message: { role: 'user', content: 'Check the key' } }),
      line({
        type: 'assistant', timestamp: at(4), isSidechain: true,
        message: {
          id: 'msg_1', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: 'text', text: `It is ${TOKEN}. Should I revoke it?` }],
        },
      }),
    ].join('\n'));
    const report = sessionEvents(root, 's1', dir).find((e) => e.kind === 'subagent-stop');
    expect(report).toMatchObject({ lastMessage: 'It is [redacted]. Should I revoke it?', question: 'Should I revoke it?' });
    expect(listSessions(root, dir)[0]?.title).toBe('Rotate [redacted] please');
  });
});

describe('long free text stays cheap', () => {
  // The office answers each hook before Claude Code goes on, and a hook body may be 1 MB: nothing here may take long.
  const fast = (fn: () => unknown) => {
    const started = performance.now();
    fn();
    return performance.now() - started;
  };

  it('finds the closing question of 1 MB of underscores in well under 100 ms', () => {
    expect(fast(() => closingQuestion('_'.repeat(1024 * 1024)))).toBeLessThan(100);
    // The slow case for a trailing pattern: a long run that doesn't reach the end.
    expect(fast(() => closingQuestion(`${'_'.repeat(1024 * 1024)}x`))).toBeLessThan(100);
  });

  it('turns a 1 MB report into an event in well under 100 ms', () => {
    for (const report of ['_'.repeat(1024 * 1024), `${'_'.repeat(1024 * 1024)}x`, `${' '.repeat(1024 * 1024)}Done?`]) {
      expect(fast(() => normalizeHook({ ...base, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'qa', last_assistant_message: report }, 1))).toBeLessThan(100);
    }
  });

  it('masks a value with a long run of dots in it in well under 100 ms', () => {
    expect(fast(() => redactSecrets(`password=a1${'.'.repeat(1024 * 1024)}x`))).toBeLessThan(100);
  });
});
