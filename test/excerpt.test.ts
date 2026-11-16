import { describe, expect, it } from 'vitest';
import { transcriptExcerpt } from '../src/core/excerpt.ts';
import { transcript } from './fixtures.ts';

const T0 = Date.parse('2026-11-04T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const jsonl = (...entries: object[]) => entries.map((e) => JSON.stringify(e)).join('\n');
const userSays = (s: number, content: unknown, extra: object = {}) => ({ type: 'user', timestamp: at(s), message: { role: 'user', content }, ...extra });
const agentSays = (s: number, text: string) => ({ type: 'assistant', timestamp: at(s), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolCall = (s: number, id: string, name: string, input: object) =>
  ({ type: 'assistant', timestamp: at(s), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (s: number, id: string, content: unknown, isError = false) =>
  ({ type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
/** What the person types while Claude works, as Claude Code 2.1 records it. */
const queued = (s: number, prompt: unknown) => ({ type: 'attachment', timestamp: at(s), attachment: { type: 'queued_command', prompt, commandMode: 'prompt' } });

const subagent = { who: 'Reviewer', lead: false };
const lead = { who: 'Lead', lead: true };
/** The text between a section title and the next blank line. */
const section = (text: string, title: string) => text.slice(text.indexOf(title)).split('\n\n')[0] ?? '';
/** Made-up credentials, assembled at run time so no secret scanner mistakes this file for a leak. */
const fake = (prefix: string, length = 40) => prefix + 'a1B2c3D4e5F6g7H8i9J0'.repeat(10).slice(0, length);

describe('transcriptExcerpt on transcripts from Claude Code 2.1.312', () => {
  it("tells a subagent's brief, its step with the result, and its report", () => {
    const excerpt = transcriptExcerpt(transcript('subagent'), { ...subagent, cwd: '/project' });
    expect(excerpt.text).toBe([
      'Transcript excerpt of Reviewer: the brief they were given, each step oldest first, and the latest report.',
      '',
      'Brief:',
      'Read the file /project/notes.txt and report its contents.',
      '',
      'Steps, oldest first:',
      '- Reads notes.txt',
      '  Result: 1\thello',
      '',
      'Latest report:',
      'The file `notes.txt` contains one line: `hello`.',
    ].join('\n'));
    expect(excerpt).toMatchObject({ steps: 2, omitted: 0, empty: false });
  });

  it('gives the lead what the person asked, each step, and the last word', () => {
    const { text, steps } = transcriptExcerpt(transcript('main'), { ...lead, cwd: '/project' });
    expect(section(text, 'What the person asked')).toMatch(/^What the person asked, oldest first:\n1\. Do these steps in order\. .* Then reply with the single word: finished\.$/);
    const lines = section(text, 'Steps').split('\n').filter((line) => line.startsWith('- '));
    expect(lines.map((line) => line.replace(/: .*/, ''))).toEqual([
      '- The person writes', '- Writes notes.txt', '- Briefs reviewer', '- Says', '- Hears back', '- Print done', '- Show Node version',
    ]);
    expect(text).toContain('- Show Node version\n  Result: v24.22.1\n  Shell cwd was reset to /project');
    expect(text).toMatch(/Latest report:\nfinished$/);
    expect(steps).toBe(8);
  });

  it("passes on a background agent's report and not the launch notice meant for Claude", () => {
    const { text } = transcriptExcerpt(transcript('main'), { ...lead, cwd: '/project' });
    expect(text).toContain('- Briefs reviewer: Read notes.txt contents\n  Result: Started in the background; its report comes back later.');
    expect(text).toContain('- Hears back: Agent "Read notes.txt contents" finished: The file `notes.txt` contains one line: `hello`.');
    expect(text).not.toContain('internal metadata');
    expect(text).not.toContain('<system-reminder>');
  });

  it('answers a replay from what had happened by its position', () => {
    // The moment the lead said steps 1 and 2 were under way: the notification and both commands come later.
    const { text, steps } = transcriptExcerpt(transcript('main'), { ...lead, cwd: '/project', until: Date.parse('2026-11-04T13:32:54.478Z') });
    expect(text).not.toContain('Hears back');
    expect(text).not.toContain('Node version');
    expect(text).toMatch(/Latest report:\nSteps 1 and 2 are in progress\./);
    expect(steps).toBe(4);
  });
});

describe('transcriptExcerpt budget', () => {
  const items = Array.from({ length: 200 }, (_, i) => String(i).padStart(3, '0'));
  const busy = jsonl(
    userSays(0, 'Process the 200 items'),
    ...items.flatMap((n, i) => [toolCall(i * 2 + 1, `t${n}`, 'Bash', { command: `check ${n}`, description: `Check item ${n}` }), toolResult(i * 2 + 2, `t${n}`, 'x'.repeat(500))]),
    agentSays(500, 'All 200 items are checked.'),
  );

  it('drops the oldest steps first to fit, and says how many', () => {
    const excerpt = transcriptExcerpt(busy, { ...subagent, budgetChars: 20_000 });
    expect(excerpt.text.length).toBeLessThanOrEqual(20_000);
    expect(excerpt.omitted).toBeGreaterThan(0);
    expect(excerpt.steps + excerpt.omitted).toBe(201);
    expect(excerpt.text).toContain(`Steps, oldest first (the ${excerpt.omitted} earliest are left out to fit):`);
    expect(excerpt.text).toContain('- Check item 199');
    expect(excerpt.text).not.toContain('- Check item 000');
    expect(excerpt.text).toContain('Brief:\nProcess the 200 items');
    expect(excerpt.text).toMatch(/Latest report:\nAll 200 items are checked\.$/);
  });

  it('fits in 60,000 characters by default', () => {
    const long = jsonl(userSays(0, 'Go'), ...Array.from({ length: 400 }, (_, i) => agentSays(i + 1, `Note ${i}: ${'y'.repeat(1_400)}`)));
    const excerpt = transcriptExcerpt(long, subagent);
    expect(excerpt.text.length).toBeLessThanOrEqual(60_000);
    expect(excerpt.text.length).toBeGreaterThan(50_000);
  });

  it('keeps the brief, cut to about 4,000 characters, however much else there is', () => {
    const brief = `Plan the importer. ${'Every column needs a parser and a test. '.repeat(250)}`;
    const { text } = transcriptExcerpt(jsonl(userSays(0, brief), ...busy.split('\n').slice(1).map((line) => JSON.parse(line) as object)), { ...subagent, budgetChars: 20_000 });
    const kept = section(text, 'Brief:');
    expect(kept.startsWith('Brief:\nPlan the importer. Every column needs a parser and a test.')).toBe(true);
    expect(kept.length).toBeLessThanOrEqual('Brief:\n'.length + 4_000);
    expect(kept.endsWith('…')).toBe(true);
  });
});

describe('transcriptExcerpt steps', () => {
  it('trims a long tool result and marks a failed one', () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Run the checks'),
      toolCall(1, 'a', 'Read', { file_path: '/p/big.txt' }),
      toolResult(2, 'a', 'z'.repeat(5_000)),
      toolCall(3, 'b', 'Bash', { command: 'npm test' }),
      toolResult(4, 'b', '<tool_use_error>Exit code 1\nFAIL test/parser.test.ts</tool_use_error>', true),
    ), { ...subagent, cwd: '/p' });
    const result = text.split('\n').find((line) => line.startsWith('  Result: z')) ?? '';
    expect(result.length).toBeLessThanOrEqual('  Result: '.length + 600);
    expect(result.endsWith('…')).toBe(true);
    expect(text).toContain('- Runs npm test\n  Failed: Exit code 1\n  FAIL test/parser.test.ts');
  });

  it('marks the calls still running at the end, and only those', () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Ship it'),
      toolCall(1, 'a', 'Bash', { command: 'npm run build', run_in_background: true }),
      agentSays(2, 'The build runs in the background; now the tests.'),
      toolCall(3, 'b', 'Bash', { command: 'npm test' }),
    ), subagent);
    expect(text).toContain('- Runs npm run build\n');
    expect(text).not.toContain('npm run build (no result yet)');
    expect(text).toContain('- Runs npm test (no result yet)');
  });

  it('shows paths relative to the project folder', () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Fix the header'),
      toolCall(1, 'a', 'Edit', { file_path: 'C:\\proj\\src\\App.tsx', old_string: 'a', new_string: 'b' }),
    ), { ...subagent, cwd: 'C:\\proj' });
    expect(text).toContain('- Edits src/App.tsx');
  });

  it('takes the project folder from the transcript when none is given', () => {
    const { text } = transcriptExcerpt(jsonl(
      { ...userSays(0, 'Fix the header'), cwd: '/work/app' },
      toolCall(1, 'a', 'Write', { file_path: '/work/app/src/header.ts', content: '' }),
    ), subagent);
    expect(text).toContain('- Writes src/header.ts');
  });

  it("shows the plan an agent keeps, so it can say what's left", () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Build the importer'),
      toolCall(1, 'a', 'TodoWrite', { todos: [
        { content: 'Parse CSV', status: 'completed', activeForm: 'Parsing CSV' },
        { content: 'Report bad rows', status: 'in_progress', activeForm: 'Reporting bad rows' },
        { content: 'Write the docs', status: 'pending', activeForm: 'Writing the docs' },
      ] }),
    ), subagent);
    expect(text).toContain('- Updates the plan: Parse CSV (done); Report bad rows (in progress); Write the docs (to do)');
  });

  it('gives a glimpse of the input of a tool the office has no words for', () => {
    const { text } = transcriptExcerpt(jsonl(userSays(0, 'Go'), toolCall(1, 'a', 'TaskUpdate', { taskId: '3', status: 'completed' })), subagent);
    expect(text).toContain('- Uses TaskUpdate: {"taskId":"3","status":"completed"}');
  });

  it('reads what the person typed while the lead was working', () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Build the importer'),
      toolCall(1, 'a', 'Bash', { command: 'npm test' }),
      queued(2, 'Also add a --dry-run flag'),
      queued(3, '<task-notification>\n<status>completed</status>\n<summary>Agent "Review the parser" finished</summary>\n<result>Two edge cases fail.</result>\n</task-notification>'),
      toolResult(4, 'a', 'ok'),
    ), lead);
    expect(section(text, 'What the person asked')).toBe('What the person asked, oldest first:\n1. Build the importer\n2. Also add a --dry-run flag');
    expect(text).toContain('- The person writes: Also add a --dry-run flag');
    expect(text).toContain('- Hears back: Agent "Review the parser" finished: Two edge cases fail.');
  });

  it("keeps only what the person typed in the lead's brief", () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Caveat: the messages below were generated by the user while running local commands.', { isMeta: true }),
      userSays(1, '<system-reminder>\nThe date changed.\n</system-reminder>'),
      userSays(2, 'Fix the parser'),
      userSays(3, 'Brief for a subagent', { isSidechain: true }),
      userSays(4, '<task-notification>\n<summary>A background command finished</summary>\n</task-notification>'),
      userSays(5, [{ type: 'text', text: '<system-reminder>Linked file</system-reminder>' }, { type: 'text', text: 'And keep the old API' }]),
    ), lead);
    expect(section(text, 'What the person asked')).toBe('What the person asked, oldest first:\n1. Fix the parser\n2. And keep the old API');
    expect(text).not.toContain('Brief for a subagent');
    expect(text).not.toContain('Caveat');
  });

  it('reads a slash command the person typed as part of the brief', () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, '<command-message>fix-bug</command-message>\n<command-name>/fix-bug</command-name>\n<command-args>the parser crashes on empty lines</command-args>'),
    ), lead);
    expect(section(text, 'What the person asked')).toBe('What the person asked, oldest first:\n1. /fix-bug the parser crashes on empty lines');
  });

  it('keeps the first and the newest of many messages, and counts the ones in between', () => {
    const many = Array.from({ length: 40 }, (_, i) => userSays(i, `Message ${i}: ${'please keep going with the importer. '.repeat(10)}`));
    const brief = section(transcriptExcerpt(jsonl(...many), lead).text, 'What the person asked');
    expect(brief).toContain('1. Message 0:');
    expect(brief).toContain('40. Message 39:');
    expect(brief).toMatch(/\(\d+ messages in between left out\)/);
    expect(brief.length).toBeLessThanOrEqual(4_000);
  });

  it('masks secrets in the brief, in what the agent wrote and in results', () => {
    const key = fake('sk-ant-api03-', 90);
    const token = fake('ghp_', 36);
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, `Deploy with ANTHROPIC_API_KEY=${key}`),
      toolCall(1, 'a', 'Bash', { command: 'cat .env' }),
      toolResult(2, 'a', `GITHUB_TOKEN=${token}\nDB_PASSWORD=supersecret`),
      agentSays(3, `Found the token ${token} in .env.`),
    ), subagent);
    expect(text).not.toContain(key);
    expect(text).not.toContain(token);
    expect(text).not.toContain('supersecret');
    expect(text).toContain('Brief:\nDeploy with ANTHROPIC_API_KEY=[redacted]');
    expect(text).toContain('Result: GITHUB_TOKEN=[redacted]\n  DB_PASSWORD=[redacted]');
  });

  it('masks a secret the trim would cut in half', () => {
    const token = fake('ghp_', 36);
    const { text } = transcriptExcerpt(jsonl(userSays(0, 'Check the logs'), toolCall(1, 'a', 'Read', { file_path: '/p/log.txt' }), toolResult(2, 'a', `${'x'.repeat(590)} ${token}`)), subagent);
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain('a1B2');
  });
});

describe('transcriptExcerpt on odd input', () => {
  it('skips lines that are not transcript entries, and never throws', () => {
    const odd = [
      'not json', '[1,2,3]', '{}', 'null', '{"truncated": ',
      '{"type":"assistant","message":"oops"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":42}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"nobody","content":"x"}]}}',
      '{"type":"user","timestamp":"not a date","message":{"content":"Do the thing"}}',
      JSON.stringify(agentSays(1, 'Done the thing.')),
    ].join('\r\n');
    const excerpt = transcriptExcerpt(odd, subagent);
    expect(excerpt.text).toContain('Brief:\nDo the thing');
    expect(excerpt.text).toMatch(/Latest report:\nDone the thing\.$/);
    expect(excerpt).toMatchObject({ steps: 1, omitted: 0, empty: false });
  });

  it('is empty for an empty file', () => {
    expect(transcriptExcerpt('', subagent)).toMatchObject({ steps: 0, omitted: 0, empty: true });
  });

  it('is empty when nothing had happened by the replay position', () => {
    expect(transcriptExcerpt(transcript('subagent'), { ...subagent, until: Date.parse('2026-11-04T13:00:00.000Z') })).toMatchObject({ empty: true, steps: 0 });
  });

  it('keeps unicode intact and never cuts a character in half', () => {
    const { text } = transcriptExcerpt(jsonl(
      userSays(0, 'Übersetze die Oberfläche: 設定画面 und Schaltflächen 🌱'),
      toolCall(1, 'a', 'Read', { file_path: '/p/emoji.txt' }),
      toolResult(2, 'a', '😀'.repeat(400)),
    ), subagent);
    expect(text).toContain('Brief:\nÜbersetze die Oberfläche: 設定画面 und Schaltflächen 🌱');
    expect(text).toMatch(/Result: (?:😀)+…/u);
    expect(text).not.toMatch(/\p{Cs}/u);
  });
});
