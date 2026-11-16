// v0.2: a report is a fixed small form (state, files, check, open, note) that code can read, with tight limits that cut and
// never refuse. The old outcome and summary still work: the summary is the note, and nothing in the call changes for them.
import { afterEach, describe, expect, it } from 'vitest';
import { closeServers, ok, office, refused } from './orgtools-kit.ts';

afterEach(closeServers);

const reportCall = (o: Awaited<ReturnType<typeof office>>) => o.company.calls.find((c) => c.method === 'report');

describe('the report tool', () => {
  it('lists the form: state, files, check, open and note, each with its limit in words, and nothing required but what the call needs', async () => {
    const o = await office();
    const listed = await o.listed('ui-designer', 'report');
    const schema = listed.inputSchema as { properties: Record<string, Record<string, unknown>>; required?: string[]; additionalProperties: boolean };
    expect(Object.keys(schema.properties)).toEqual(['task', 'state', 'files', 'check', 'open', 'note', 'outcome', 'summary']);
    // Optional in the schema, so the old form still works; the call says what it needs.
    expect(schema.required ?? []).toEqual([]);
    expect(schema.properties.state).toMatchObject({ enum: ['done', 'blocked', 'progress'] });
    expect(schema.properties.check).toMatchObject({ type: 'object', required: ['ran', 'passed'], properties: { ran: { type: 'string' }, passed: { type: 'boolean' }, tail: { type: 'string' } } });
    // A client that enforces maxLength or maxItems would refuse what the office cuts, so the limits are in the words.
    for (const name of ['note', 'summary']) expect(schema.properties[name]).not.toHaveProperty('maxLength');
    for (const name of ['files', 'open']) expect(schema.properties[name]).not.toHaveProperty('maxItems');
    expect(schema.properties.note?.description).toContain('up to 600 characters');
    expect(schema.properties.open?.description).toContain('up to 8 lines of 200 characters');
    expect(JSON.stringify(schema.properties.check)).toContain('up to 400 characters');
    expect(listed.description).toContain('Done with a passed check and nothing open closes the task without a turn for your manager');
  });

  it('passes the form to the company, with the old fields left out', async () => {
    const o = await office();
    const answer = await o.call('ui-designer', 'report', {
      task: 't-1',
      state: 'done',
      files: ['src/card.tsx', 'src/card.test.tsx'],
      check: { ran: 'npm test', passed: true },
      open: [],
      note: 'Streak card done.',
    });
    expect(answer.isError).toBe(false);
    expect(reportCall(o)).toEqual({
      method: 'report',
      by: 'ui-designer',
      input: { taskId: 't-1', outcome: 'done', text: 'Streak card done.', form: { files: ['src/card.tsx', 'src/card.test.tsx'], open: [], check: { ran: 'npm test', passed: true } } },
    });
  });

  it('takes the form without a note, and a blocked report with its open lines', async () => {
    const o = await office();
    await o.call('ui-designer', 'report', { task: 't-1', state: 'blocked', files: [], open: ['The brand colours are missing.'] });
    expect(reportCall(o)?.input).toMatchObject({ outcome: 'blocked', text: '', form: { open: ['The brand colours are missing.'] } });
  });

  it('keeps the old outcome and summary working, as the note, and sends no form', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'report', { outcome: 'done', summary: 'The card shows the streak.', task: 't-1' })).toEqual(ok('Reported to Ada, head of design; "Build the streak card" (t-1) is waiting for review.'));
    expect(reportCall(o)?.input).toEqual({ taskId: 't-1', outcome: 'done', text: 'The card shows the streak.' });
  });

  it('cuts what is too long and never refuses for length: the note, the old summary, the lists and the tail', async () => {
    const o = await office();
    const answer = await o.call('ui-designer', 'report', {
      state: 'progress',
      note: 'n'.repeat(900),
      files: Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`),
      open: Array.from({ length: 12 }, (_, i) => `${i}: ${'o'.repeat(300)}`),
      check: { ran: 'r'.repeat(300), passed: false, tail: 't'.repeat(900) },
    });
    expect(answer.isError).toBe(false);
    const form = (reportCall(o)?.input as { text: string; form: { files: string[]; open: string[]; check: { ran: string; tail: string } } }) ?? null;
    expect(form.text).toHaveLength(600);
    expect(form.text.endsWith('…')).toBe(true);
    expect(form.form.files).toHaveLength(30);
    expect(form.form.open).toHaveLength(8);
    expect(form.form.open.every((line) => line.length <= 200)).toBe(true);
    expect(form.form.check.ran).toHaveLength(200);
    expect(form.form.check.tail).toHaveLength(400);

    const old = await o.call('ui-designer', 'report', { outcome: 'progress', summary: 's'.repeat(4_667) });
    expect(old.isError).toBe(false);
    expect((o.company.calls.at(-1)?.input as { text: string }).text).toHaveLength(4_000);
  });

  it('asks for what it needs by name when the call has neither the form nor the old fields', async () => {
    const o = await office();
    expect(await o.call('ui-designer', 'report', { task: 't-1' })).toEqual(refused('report needs state: done, blocked or progress, with files, check and open (or the old outcome and summary).'));
    expect(await o.call('ui-designer', 'report', { outcome: 'done', task: 't-1' })).toEqual(refused('report needs a note, or the form: files, check and open.'));
    expect((await o.call('ui-designer', 'report', { state: 'done', check: { ran: 'npm test' } })).text).toBe('check needs passed. true when it passed.');
  });
});
