import { describe, expect, it } from 'vitest';
import { HubGate } from '../src/hub/gate.ts';
import { DeskTokens } from '../src/hub/tokens.ts';

describe('the desk-token table', () => {
  it('issues 32 random bytes as hex, one token per desk', () => {
    const tokens = new DeskTokens();
    const a = tokens.issue('plant-pal', 'ux-designer');
    const b = tokens.issue('plant-pal', 'ux-designer');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(tokens.size).toBe(2);
  });

  it('resolves a token to its company, person, folder and scratch folder', () => {
    const tokens = new DeskTokens();
    const token = tokens.issue('plant-pal', 'qa-engineer', 'C:\\work\\plant-pal-t3', 'C:\\Temp\\worklings-desk-a1\\scratch');
    expect(tokens.resolve(token)).toEqual({ companyId: 'plant-pal', person: 'qa-engineer', cwd: 'C:\\work\\plant-pal-t3', scratch: 'C:\\Temp\\worklings-desk-a1\\scratch' });
    expect(tokens.resolve(tokens.issue('plant-pal', 'ceo'))).toEqual({ companyId: 'plant-pal', person: 'ceo', cwd: null, scratch: null });
  });

  it('refuses missing, malformed, unknown and nearly right tokens', () => {
    const tokens = new DeskTokens();
    const token = tokens.issue('plant-pal', 'ceo');
    const last = token.at(-1) === '0' ? '1' : '0';
    for (const wrong of [null, undefined, '', 'nope', token.toUpperCase(), `${token}0`, token.slice(1), `${token.slice(0, -1)}${last}`, ` ${token}`]) {
      expect(tokens.resolve(wrong)).toBeNull();
    }
  });

  it('forgets a revoked token, and every token of a company that closes', () => {
    const tokens = new DeskTokens();
    const one = tokens.issue('plant-pal', 'ceo');
    const two = tokens.issue('plant-pal', 'ux-designer');
    const other = tokens.issue('cafe-lumen', 'ceo');
    expect(tokens.revoke(one)).toBe(true);
    expect(tokens.revoke(one)).toBe(false);
    expect(tokens.resolve(one)).toBeNull();
    expect(tokens.revokeCompany('plant-pal')).toBe(1);
    expect(tokens.resolve(two)).toBeNull();
    expect(tokens.resolve(other)).toMatchObject({ companyId: 'cafe-lumen' });
  });
});

describe("the hub's desk cap", () => {
  it('lends desks across companies up to the cap and tells waiting switchboards when one frees', async () => {
    const gate = new HubGate(2);
    const freed: number[] = [];
    gate.onFree(() => freed.push(gate.inUse));
    expect([gate.take('a'), gate.take('b'), gate.take('a')]).toEqual([true, true, false]);
    gate.give('a');
    expect(gate.inUse).toBe(1);
    await Promise.resolve();
    expect(freed).toEqual([1]);
    expect(gate.take('b')).toBe(true);
  });

  it("never frees a desk a company didn't hold, and gives back all of a closing company's", async () => {
    const gate = new HubGate(3);
    gate.take('a');
    gate.take('a');
    gate.take('b');
    gate.give('c');
    expect(gate.inUse).toBe(3);
    gate.release('a');
    expect(gate.inUse).toBe(1);
    gate.give('a');
    expect(gate.inUse).toBe(1);
  });

  it('lets more in at once when the cap grows', async () => {
    const gate = new HubGate(1);
    let told = 0;
    gate.onFree(() => (told += 1));
    expect(gate.take('a')).toBe(true);
    expect(gate.take('b')).toBe(false);
    gate.setMax(2);
    await Promise.resolve();
    expect(told).toBe(1);
    expect(gate.take('b')).toBe(true);
    gate.setMax(1);
    expect(gate.take('c')).toBe(false);
  });
});
