import { describe, expect, it } from 'vitest';
import type { OfficeEvent } from '../src/core/events.ts';
import { newCursor, readUsage, replayEvents } from '../src/core/transcript.ts';
import { addUsage, ZERO_USAGE } from '../src/core/usage.ts';
import { SESSION, SUBAGENT, transcript } from './fixtures.ts';

const sum = (events: OfficeEvent[]) =>
  events.reduce((u, e) => (e.kind === 'usage' ? addUsage(u, e.usage) : u), ZERO_USAGE);

describe('readUsage', () => {
  it('counts each API message once although Claude Code writes it once per content block', () => {
    const events = readUsage(transcript('main'), newCursor(), { sessionId: SESSION, fallbackTime: 0 });
    expect(events).toHaveLength(5);
    expect(sum(events)).toEqual({ input: 12, output: 1073, cacheRead: 184_308, cacheWrite5m: 0, cacheWrite1h: 48_009 });
    expect(events[0]).toMatchObject({ kind: 'usage', model: 'claude-haiku-5-5', sessionId: SESSION });
    expect(events[0]?.at).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('attributes a subagent transcript to the subagent', () => {
    const events = readUsage(transcript('subagent'), newCursor(), { sessionId: SESSION, agentId: SUBAGENT, agentType: 'reviewer', fallbackTime: 0 });
    expect(events.map((e) => e.agentId)).toEqual([SUBAGENT, SUBAGENT]);
    expect(sum(events)).toEqual({ input: 4, output: 299, cacheRead: 5194, cacheWrite5m: 6101, cacheWrite1h: 0 });
  });

  it('waits for the rest of a line that arrives in two chunks', () => {
    const text = transcript('main');
    const cut = text.indexOf('"usage"') + 3;
    const cursor = newCursor();
    const first = readUsage(text.slice(0, cut), cursor, { sessionId: SESSION, fallbackTime: 0 });
    const second = readUsage(text.slice(cut), cursor, { sessionId: SESSION, fallbackTime: 0 });
    expect(first.length + second.length).toBe(5);
    expect(sum([...first, ...second]).output).toBe(1073);
  });

  it('reads a line that arrives in many small chunks, and drops one too long to be a transcript line', () => {
    const ctx0 = { sessionId: SESSION, fallbackTime: 0 };
    const line = transcript('main').split('\n').find((l) => readUsage(`${l}\n`, newCursor(), ctx0).length === 1) ?? '';
    expect(line).not.toBe('');
    const cursor = newCursor();
    const events: OfficeEvent[] = [];
    for (let i = 0; i < line.length; i += 7) events.push(...readUsage(line.slice(i, i + 7), cursor, { sessionId: SESSION, fallbackTime: 0 }));
    events.push(...readUsage('\n', cursor, { sessionId: SESSION, fallbackTime: 0 }));
    expect(events).toHaveLength(1);
    // With a 100-character limit, the long line is dropped up to its newline and the line after it still counts.
    const small = newCursor();
    const ctx = { sessionId: SESSION, fallbackTime: 0 };
    expect(readUsage('x'.repeat(80), small, ctx, 100)).toEqual([]);
    expect(readUsage('y'.repeat(80), small, ctx, 100)).toEqual([]);
    expect(small).toMatchObject({ pending: '', skipping: true });
    expect(readUsage(`still the long line\n${line}\n`, small, ctx, 100 + line.length)).toHaveLength(1);
    expect(small).toMatchObject({ pending: '', skipping: false });
  });

  it('skips lines that are not JSON or not assistant messages', () => {
    const junk = 'not json\n{"type":"assistant","message":{"id":"m1","model":"<synthetic>","usage":{"output_tokens":5}}}\n{"type":"user"}\n';
    expect(readUsage(junk, newCursor(), { sessionId: 's', fallbackTime: 7 })).toEqual([]);
  });
});

describe('replayEvents', () => {
  it('rebuilds prompts, tool calls, the spawn and usage from a finished transcript', () => {
    const events = replayEvents(transcript('main'), { sessionId: SESSION, cwd: '/project', fallbackTime: 0 });
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'tool-start')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'tool-end')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'usage')).toHaveLength(5);
    expect(events.find((e) => e.kind === 'prompt')).toMatchObject({ notification: false });
    expect(events.find((e) => e.kind === 'tool-start' && e.tool === 'Agent')).toMatchObject({ spawn: { agentType: 'reviewer' } });
    expect(events.find((e) => e.kind === 'tool-end' && e.tool === 'Write')).toMatchObject({ ok: true, file: 'notes.txt' });
    const times = events.map((e) => e.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  // Claude Code 2.1 records what the person types while Claude works, and most task notifications, as attachments.
  const at = (s: number) => new Date(Date.parse('2026-11-04T10:00:00.000Z') + s * 1000).toISOString();
  const queued = (s: number, prompt: unknown, extra: object = {}) =>
    ({ type: 'attachment', timestamp: at(s), attachment: { type: 'queued_command', prompt, commandMode: 'prompt' }, ...extra });
  const lines = (...entries: object[]) => entries.map((e) => JSON.stringify(e)).join('\n');
  const prompts = (text: string, agentId?: string) =>
    replayEvents(text, { sessionId: 's', fallbackTime: 0, ...(agentId ? { agentId, agentType: 'reviewer' } : {}) }).filter((e) => e.kind === 'prompt');

  it('reads a SendMessage to a subagent as a new brief for it, the way the hook does', () => {
    const text = lines({
      type: 'assistant', timestamp: at(1),
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'SendMessage', input: { to: 'a4e964624f302ccfe', summary: 'Re-check the security fixes', message: 'Please…' } }] },
    });
    expect(replayEvents(text, { sessionId: 's', fallbackTime: 0 }).find((e) => e.kind === 'tool-start'))
      .toMatchObject({ tool: 'SendMessage', brief: { agentId: 'a4e964624f302ccfe', description: 'Re-check the security fixes' } });
  });

  it('reads what the person typed while Claude worked as prompts', () => {
    const text = lines(
      { type: 'user', timestamp: at(0), message: { role: 'user', content: 'Build the CSV importer' } },
      { type: 'assistant', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
      queued(2, 'Also add a --dry-run flag'),
      queued(3, [{ type: 'image', source: { type: 'base64', data: '' } }, { type: 'text', text: 'Make the report look like this' }]),
      { type: 'user', timestamp: at(4), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    );
    expect(prompts(text)).toEqual([
      { kind: 'prompt', at: Date.parse(at(0)), sessionId: 's', text: 'Build the CSV importer', notification: false },
      { kind: 'prompt', at: Date.parse(at(2)), sessionId: 's', text: 'Also add a --dry-run flag', notification: false },
      { kind: 'prompt', at: Date.parse(at(3)), sessionId: 's', text: 'Make the report look like this', notification: false },
    ]);
  });

  it('reads a task notification delivered while Claude worked as one, the way the hook does', () => {
    const notification = '<task-notification>\n<status>completed</status>\n<summary>Agent "Review the parser" finished</summary>\n</task-notification>';
    expect(prompts(lines(queued(1, notification)))).toEqual([
      { kind: 'prompt', at: Date.parse(at(1)), sessionId: 's', text: 'A background task finished', notification: true },
    ]);
  });

  it("skips queued messages that aren't the person's: tagged ones, a subagent's, and other attachments", () => {
    const text = lines(
      // A message from another session is that session's brief and shows as the request (test/cross-session.test.ts).
      queued(1, '<system-reminder>The date changed.</system-reminder>'),
      queued(2, 'A note from the coordinator', { isSidechain: true }),
      { type: 'attachment', timestamp: at(3), attachment: { type: 'hook_success', content: 'Add a test for empty rows' } },
      queued(4, '   '),
    );
    expect(prompts(text)).toEqual([]);
    expect(prompts(lines(queued(1, 'Keep going')), 'a1')).toEqual([]);
  });
});
