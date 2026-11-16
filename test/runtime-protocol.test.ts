// The stream-json protocol against what Claude Code 2.1.312 really wrote (test/fixtures/claude-2.1.312/desk/ and
// mcp/), and the reading of failures and limits.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exitProblem, isMissingSession, OVERLOAD_REST_MS, resetFromText, turnFailure } from '../src/runtime/limits.ts';
import { type DeskEvent, interruptLine, LineSplitter, parseLine, turnEnd, userLine } from '../src/runtime/protocol.ts';

const DESK = fileURLToPath(new URL('./fixtures/claude-2.1.312/desk/', import.meta.url));
const MCP = fileURLToPath(new URL('./fixtures/claude-2.1.312/mcp/', import.meta.url));

interface Recorded {
  from: string;
  line?: Record<string, unknown>;
}
const recorded = (file: string): Recorded[] =>
  readFileSync(`${DESK}${file}`, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Recorded);
/** What the desk wrote in a fixture, read the way the switchboard reads it. */
const deskSaid = (file: string): DeskEvent[] => recorded(file).flatMap((e) => (e.from === 'claude' && e.line ? [parseLine(JSON.stringify(e.line))] : []));
const results = (events: DeskEvent[]) => events.flatMap((e) => (e.kind === 'result' ? [e.end] : []));

describe('reading what a desk writes', () => {
  it('reads every line Claude Code 2.1.312 wrote in the recorded exchanges', () => {
    const files = readdirSync(DESK).filter((f) => f.endsWith('.jsonl') && f !== 'transcript.jsonl');
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      for (const e of deskSaid(file)) expect(e.kind, file).not.toBe('malformed');
    }
    for (const file of ['desk-stream.jsonl', 'denied-stream.jsonl', 'unauthorized-stream.jsonl']) {
      const lines = readFileSync(`${MCP}${file}`, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) expect(parseLine(line).kind, file).not.toBe('malformed');
    }
  });

  it("takes a turn's cost from model_usage_since_last_result, never the session's running total", () => {
    const [first, second] = results(deskSaid('busy-message.jsonl'));
    expect(first?.costUsd).toBeCloseTo(0.00504722, 10);
    // The second result's total_cost_usd (0.00674083) is the session's; the turn itself cost this:
    expect(second?.costUsd).toBeCloseTo(0.00169361, 10);
  });

  it('lists every user line a turn took, the one that joined it mid-turn included', () => {
    const lines = recorded('busy-message.jsonl').flatMap((e) => (e.from === 'switchboard' && e.line?.type === 'user' ? [String(e.line.uuid)] : []));
    const [, second] = results(deskSaid('busy-message.jsonl'));
    expect(second?.uuids).toEqual([lines[1], lines[2]]);
  });

  it("measures the context from the turn's last request and knows the model's window", () => {
    const [first] = results(deskSaid('busy-message.jsonl'));
    expect(first?.contextTokens).toBe(2 + 16_842 + 23_993);
    expect(first?.contextWindow).toBe(1_000_000);
    expect(first?.usage).toEqual({ input: 2, output: 160, cacheRead: 16_842, cacheWrite: 23_993 });
  });

  it('follows each message through command_lifecycle and the session through its states', () => {
    const events = deskSaid('busy-message.jsonl');
    const states = events.flatMap((e) => (e.kind === 'lifecycle' ? [e.state] : []));
    expect(states.slice(0, 2)).toEqual(['queued', 'started']);
    expect(states).toContain('completed');
    expect(events.filter((e) => e.kind === 'state').map((e) => (e.kind === 'state' ? e.state : ''))).toEqual(['running', 'idle', 'running']);
    expect(events.filter((e) => e.kind === 'init')).toHaveLength(2);
  });

  it("reads where the desk's sign-in comes from: 'none' on the user's own plan", () => {
    const init = deskSaid('busy-message.jsonl').find((e) => e.kind === 'init');
    expect(init).toMatchObject({ kind: 'init', apiKeySource: 'none' });
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'a25d2237-da04-42aa-a95e-48f98b2c8d8b', apiKeySource: 'ANTHROPIC_API_KEY' }))).toMatchObject({ apiKeySource: 'ANTHROPIC_API_KEY' });
  });

  it("reads the tools and MCP servers an init line names, for the harness's check of a lean desk", () => {
    const init = deskSaid('busy-message.jsonl').find((e) => e.kind === 'init');
    expect(init?.kind === 'init' && init.tools).toEqual(expect.arrayContaining(['Bash', 'Read']));
    // The org tools' stream, recorded with a user's own servers loaded beside it: what a lean desk must not show.
    const stream = readFileSync(`${MCP}desk-stream.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => parseLine(l));
    const loaded = stream.find((e) => e.kind === 'init');
    expect(loaded?.kind === 'init' && loaded.tools?.filter((t) => t.startsWith('mcp__'))).toEqual(['mcp__org__post_status', 'mcp__org__report']);
    expect(loaded?.kind === 'init' && loaded.mcpServers.map((m) => m.name)).toEqual(expect.arrayContaining(['org', 'user-server-1']));
    const line = (extra: object) => parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'a25d2237-da04-42aa-a95e-48f98b2c8d8b', ...extra }));
    expect(line({})).toMatchObject({ tools: null, mcpServers: [] });
    expect(line({ tools: ['Read', 7, null, '', 'x'.repeat(201), { a: 1 }, 'mcp__org__send'], mcp_servers: [{ name: 'org', status: 'connected' }, { name: 'a' }, 'b', { status: 'x' }] })).toMatchObject({
      tools: ['Read', 'mcp__org__send'],
      mcpServers: [{ name: 'org', status: 'connected' }, { name: 'a', status: 'unknown' }],
    });
    // A line with a huge tool list is cut, not trusted.
    expect((line({ tools: Array.from({ length: 5000 }, (_, i) => `t${i}`) }) as { tools: string[] }).tools).toHaveLength(2000);
  });

  it('opens a tool call on its tool_use and closes it on its result', () => {
    const lines = deskSaid('busy-message.jsonl').filter((e): e is Extract<DeskEvent, { kind: 'turn-line' }> => e.kind === 'turn-line');
    const opened = lines.flatMap((e) => e.opened);
    const closed = lines.flatMap((e) => e.closed);
    expect(opened).toContain('toolu_01JJeixQJVpfXeJpjmf9zi1n');
    expect(closed).toContain('toolu_01JJeixQJVpfXeJpjmf9zi1n');
  });

  it('reads the interrupt answer and the turn it stopped', () => {
    const events = deskSaid('interrupt.jsonl');
    expect(events).toContainEqual({ kind: 'ack', requestId: 'interrupt-7910', ok: true });
    const [stopped] = results(events);
    expect(stopped).toMatchObject({ ok: false, subtype: 'error_during_execution', terminalReason: 'aborted_tools' });
    expect(events.some((e) => e.kind === 'lifecycle' && e.state === 'cancelled')).toBe(true);
  });

  it('reads the rate limit: its status, its reset in milliseconds and how much is used', () => {
    const limit = deskSaid('busy-message.jsonl').find((e) => e.kind === 'limit');
    expect(limit).toEqual({ kind: 'limit', info: { status: 'allowed_warning', resetsAt: 1_794_402_000_000, utilization: 0.42, type: 'seven_day' } });
  });

  it('counts a heartbeat, a task and a hook as signs of life, and a subagent line as work, not a call of its own', () => {
    expect(parseLine(JSON.stringify({ type: 'tool_progress', tool_use_id: 'x-heartbeat-0', heartbeat: true })).kind).toBe('progress');
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'task_started', task_id: 't' })).kind).toBe('progress');
    const sub = parseLine(JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'tool_use', id: 'toolu_2' }] } }));
    expect(sub.kind).toBe('progress');
  });

  it('never throws on a line that is not the protocol', () => {
    expect(parseLine('not json')).toEqual({ kind: 'malformed', reason: 'not-json' });
    expect(parseLine('42')).toEqual({ kind: 'malformed', reason: 'not-an-object' });
    expect(parseLine('[1,2]')).toEqual({ kind: 'malformed', reason: 'not-an-object' });
    expect(parseLine(null)).toEqual({ kind: 'malformed', reason: 'too-long' });
    expect(parseLine('{"type":"command_lifecycle","command_uuid":"--debug","state":"started"}').kind).toBe('other');
    expect(parseLine('{"type":"brand-new-kind"}')).toEqual({ kind: 'other', type: 'brand-new-kind' });
    const odd = parseLine('{"type":"result","is_error":"yes","usage":{"input_tokens":-5},"user_message_uuids":"nope","model_usage_since_last_result":{"m":{"costUSD":"1"}}}');
    expect(odd.kind).toBe('result');
    if (odd.kind === 'result') expect(odd.end).toMatchObject({ ok: true, costUsd: null, uuids: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  });
});

describe('splitting the output into lines', () => {
  it('joins a line that arrives in pieces, Unicode included, and drops blank ones', () => {
    const lines = new LineSplitter();
    expect(lines.push('{"a":"Zür')).toEqual([]);
    expect(lines.push('ich-東京"}\r\n\n{"b":1}\n{"c"')).toEqual(['{"a":"Zürich-東京"}', '{"b":1}']);
    expect(lines.push(':2}\n')).toEqual(['{"c":2}']);
    expect(lines.end()).toBeNull();
  });

  it('drops a line longer than its limit and goes on with the next', () => {
    const lines = new LineSplitter(10);
    expect(lines.push('0123456789abc')).toEqual([]);
    expect(lines.push('def\n{"ok":1}\n')).toEqual([null, '{"ok":1}']);
    expect(lines.push(`${'x'.repeat(11)}\nshort\n`)).toEqual([null, 'short']);
  });

  it('gives back a line cut off when the stream ends', () => {
    const lines = new LineSplitter();
    lines.push('{"type":"res');
    expect(lines.end()).toBe('{"type":"res');
  });
});

describe('what the switchboard writes', () => {
  it('writes a user turn and an interrupt in the shapes Claude Code 2.1.312 took', () => {
    const sent = recorded('busy-message.jsonl').find((e) => e.from === 'switchboard' && e.line?.type === 'user')?.line;
    const ours = JSON.parse(userLine('Hello', 'a25d2237-da04-42aa-a95e-48f98b2c8d8b', 'e47d8e3a-7793-4834-b863-a883f5d4abfc'));
    expect(Object.keys(ours).sort()).toEqual(Object.keys(sent ?? {}).sort());
    expect(ours.message).toEqual({ role: 'user', content: 'Hello' });
    const interrupt = recorded('interrupt.jsonl').find((e) => e.from === 'switchboard' && e.line?.type === 'control_request')?.line;
    expect(JSON.parse(interruptLine('interrupt-7910'))).toEqual(interrupt);
    expect(userLine('a\nb', 's', 'u').trimEnd()).not.toContain('\n');
  });
});

describe('failures and limits', () => {
  const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
  const end = (over: Partial<ReturnType<typeof turnEnd>>) => ({ ...turnEnd({ type: 'result', is_error: true }), ...over });

  it('reads a reset time in a named zone, and moves it to the next day once it has passed', () => {
    expect(resetFromText('You have hit your limit · resets 3pm (UTC)', NOW)).toBe(Date.UTC(2026, 10, 5, 15, 0));
    expect(resetFromText('resets 9:30am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 6, 9, 30));
    expect(resetFromText('resets 15:45 (Europe/Zurich)', NOW)).toBe(Date.UTC(2026, 10, 5, 14, 45));
  });

  it('reads a reset in local time, and one given as a wait', () => {
    const at = resetFromText("You've hit your session limit · resets 3:45pm", NOW);
    expect(at).not.toBeNull();
    const d = new Date(at ?? 0);
    expect([d.getHours(), d.getMinutes()]).toEqual([15, 45]);
    expect((at ?? 0) - NOW).toBeGreaterThan(0);
    expect((at ?? 0) - NOW).toBeLessThanOrEqual(24 * 3_600_000);
    expect(resetFromText('resets in 2 hours', NOW)).toBe(NOW + 2 * 3_600_000);
    expect(resetFromText('no time here', NOW)).toBeNull();
  });

  it('prefers the reset time of a rejected rate_limit_event', () => {
    const limit = { status: 'rejected', resetsAt: NOW + 90 * 60_000, utilization: 1, type: 'five_hour' };
    const f = turnFailure(end({ errorText: "You've hit your session limit · resets 3:45pm", apiStatus: 429 }), { interrupted: false, now: NOW, limit });
    expect(f).toMatchObject({ kind: 'limit', until: NOW + 90 * 60_000 });
    expect(f.message).toBe("Claude Code hit a usage limit: You've hit your session limit, resets 3:45pm");
  });

  it('rests a while on an overload, and names a sign-in problem, a long prompt and a stopped turn', () => {
    expect(turnFailure(end({ errorText: 'API Error: Repeated 529 Overloaded errors', apiStatus: 529 }), { interrupted: false, now: NOW, limit: null })).toMatchObject({
      kind: 'overloaded',
      until: NOW + OVERLOAD_REST_MS,
    });
    const notSignedIn = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/claude-2.1.312/print/not-signed-in.json', import.meta.url)), 'utf8'));
    expect(turnFailure(turnEnd(notSignedIn), { interrupted: false, now: NOW, limit: null }).kind).toBe('not-signed-in');
    expect(turnFailure(end({ errorText: 'Prompt is too long' }), { interrupted: false, now: NOW, limit: null }).kind).toBe('too-long');
    const stopped = results(deskSaid('interrupt.jsonl'))[0];
    expect(stopped && turnFailure(stopped, { interrupted: true, now: NOW, limit: null }).problem).toBe('Stopped before the turn finished.');
    expect(stopped && turnFailure(stopped, { interrupted: false, now: NOW, limit: null }).kind).toBe('other');
  });

  it('says why a desk exited from the end of its standard error, masked', () => {
    expect(exitProblem(3, null, 'starting\nError: the fake desk crashed on purpose\n    at main (desk.mjs:1:1)\n')).toBe('Claude Code stopped unexpectedly (exit code 3): Error: the fake desk crashed on purpose');
    expect(exitProblem(null, 'SIGKILL', '')).toBe("Claude Code stopped unexpectedly (SIGKILL) and didn't say why.");
    expect(exitProblem(1, null, 'Error: bad key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('abcdefghijklmnop');
    expect(isMissingSession('No conversation found with session ID: 0f4ce5e5')).toBe(true);
  });
});
