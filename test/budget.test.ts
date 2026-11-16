import { describe, expect, it } from 'vitest';
import { ACCOUNT_MAX_CHARS, catchUpAccount } from '../src/core/digest.ts';
import { transcriptExcerpt } from '../src/core/excerpt.ts';
import type { ActivityEntry } from '../src/core/office.ts';

// A private key, the one shape whose masking can lengthen text: once a cut has gone through the masked key, masking the
// whole text again gives it its END line back (41 characters). That second pass must never push out what matters most.
const KEY = ['-----BEGIN RSA PRIVATE KEY-----', ...Array.from({ length: 6 }, (_, i) => `MIIEowIBAAKCAQEA${String(i).repeat(48)}`), '-----END RSA PRIVATE KEY-----'].join('\n');
const at = (s: number) => new Date(Date.UTC(2026, 10, 4, 12, 0, 0) + s * 1000).toISOString();
const line = (entry: Record<string, unknown>) => JSON.stringify(entry);

describe('the excerpt keeps the latest report within its budget', () => {
  it('lets the oldest steps go when masking the whole text makes it longer', () => {
    const lines = [line({ type: 'user', timestamp: at(0), message: { role: 'user', content: 'Check the deploy keys.' } })];
    let t = 1;
    // Many short old steps fill the room to within a few characters.
    for (let i = 0; i < 300; i++) lines.push(line({ type: 'assistant', timestamp: at(t++), message: { role: 'assistant', content: [{ type: 'text', text: `Note ${String(i).padStart(4, '0')}.` }] } }));
    // The newest steps read files that hold a key, after enough text that each result is cut inside the masked key.
    for (let i = 0; i < 3; i++) {
      lines.push(line({ type: 'assistant', timestamp: at(t++), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `conf${i}.pem` } }] } }));
      lines.push(line({ type: 'user', timestamp: at(t++), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: `${'x'.repeat(560)}\n${KEY}` }] } }));
    }
    const report = 'Done: three config files hold private keys, and they should be rotated.';
    lines.push(line({ type: 'assistant', timestamp: at(t), message: { role: 'assistant', content: [{ type: 'text', text: report }] } }));

    const excerpt = transcriptExcerpt(lines.join('\n'), { who: 'QA engineer', lead: false, budgetChars: 4_000 });
    expect(excerpt.text.length).toBeLessThanOrEqual(4_000);
    expect(excerpt.text.endsWith(`Latest report:\n${report}`)).toBe(true);
    expect(excerpt.omitted).toBeGreaterThan(0);
    expect(excerpt.text).toContain('Reads conf2.pem');
    expect(excerpt.text).not.toContain('MIIEowIBAAKCAQEA');
  });
});

describe('the catch-up account keeps the newest activity within its budget', () => {
  it('lets the oldest lines go when masking the whole text makes it longer', () => {
    const until = Date.UTC(2026, 10, 4, 13, 0, 0);
    const activity: ActivityEntry[] = [];
    let id = 0;
    const add = (who: string, text: string) => activity.push({ id: ++id, kind: 'step', at: until - 3_000_000 + id * 1_000, agentKey: 's:a1', who, text, tone: 'info' });
    for (let i = 0; i < 150; i++) add('QA engineer', `Checks ${'x'.repeat(220)} ${i}`);
    // The newest lines quote a key after enough text that each is cut inside the masked key.
    for (let i = 0; i < 12; i++) add('QA engineer', `${'y'.repeat(200)} ${KEY}`);
    add('QA engineer', `NEWEST ${'y'.repeat(193)} ${KEY}`);

    const account = catchUpAccount({ studioName: 'Test', agents: [], sessions: [], activity, gateRuns: [], studio: null }, until - 3_600_000, until);
    expect(account.text.length).toBeLessThanOrEqual(ACCOUNT_MAX_CHARS);
    expect(account.text).toContain('NEWEST');
    expect(account.text).toMatch(/the \d+ earlier ones are left out/);
    expect(account.text).not.toContain('MIIEowIBAAKCAQEA');
  });
});
