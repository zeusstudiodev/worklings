import { describe, expect, it } from 'vitest';
import { apply, emptyOffice, indexStudio } from '../src/core/office.ts';
import { payroll } from '../src/core/payroll.ts';
import type { Studio } from '../src/core/studio.ts';

const studio: Studio = {
  version: 1, name: 'T', domain: 'custom', rigor: 'lean',
  departments: [{ id: 'engineering', name: 'Engineering', style: 'engineering' }, { id: 'quality', name: 'Quality', style: 'quality' }],
  roles: [
    { id: 'builder', department: 'engineering', title: 'Builder' },
    { id: 'tester', department: 'quality', title: 'Tester' },
    { id: 'sleeper', department: 'quality', title: 'Sleeper' },
  ],
  rules: [], gates: [], skills: [], fired: [],
};
const index = indexStudio(studio);
const usage = (output: number) => ({ input: 0, output, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

function office() {
  const s = emptyOffice();
  const spend = (agentId: string | undefined, agentType: string | undefined, output: number, n: number) => {
    for (let i = 0; i < n; i++) {
      apply(s, { kind: 'usage', at: i, sessionId: 's', ...(agentId ? { agentId, agentType } : {}), messageId: `${agentId}-${i}-${output}`, model: 'claude-sonnet-5-5', usage: usage(output) }, index);
    }
  };
  apply(s, { kind: 'subagent-start', at: 0, sessionId: 's', agentId: 'b1', agentType: 'builder' }, index);
  apply(s, { kind: 'subagent-start', at: 0, sessionId: 's', agentId: 'b2', agentType: 'builder' }, index);
  apply(s, { kind: 'subagent-start', at: 0, sessionId: 's', agentId: 't1', agentType: 'tester' }, index);
  apply(s, { kind: 'subagent-start', at: 0, sessionId: 's', agentId: 'x1', agentType: 'Explore' }, index);
  spend(undefined, undefined, 100_000, 1); // lead: $1
  spend('b1', 'builder', 100_000, 3); // $3
  spend('b2', 'builder', 100_000, 3); // $3
  spend('t1', 'tester', 100_000, 2); // $2
  spend('x1', 'Explore', 100_000, 1); // $1
  for (let i = 0; i < 4; i++) {
    apply(s, { kind: 'tool-start', at: i, sessionId: 's', agentId: 't1', agentType: 'tester', toolUseId: `t${i}`, tool: 'Bash', target: 'npm test' }, index);
    apply(s, { kind: 'tool-end', at: i, sessionId: 's', agentId: 't1', agentType: 'tester', toolUseId: `t${i}`, tool: 'Bash', ok: i === 0 }, index);
  }
  return Object.values(s.agents);
}

describe('payroll', () => {
  it('adds up every instance of a role and ranks by cost', () => {
    const p = payroll(office(), studio);
    expect(p.lines.map((l) => [l.id, l.shifts, Number(l.cost.toFixed(6))])).toEqual([
      ['builder', 2, 6],
      ['tester', 1, 2],
      ['lead', 1, 1],
      ['Explore', 1, 1],
    ]);
    expect(p.total.cost).toBeCloseTo(10, 6);
    expect(p.lines[0]?.share).toBeCloseTo(0.6, 6);
    expect(p.lines.find((l) => l.id === 'Explore')?.kind).toBe('contractor');
  });

  it('totals each room', () => {
    const p = payroll(office(), studio);
    expect(p.rooms.map((r) => [r.id, Number(r.cost.toFixed(6))])).toEqual([['engineering', 6], ['quality', 2]]);
  });

  it('flags idle desks, the most expensive role and a role that keeps failing', () => {
    const p = payroll(office(), studio);
    expect(p.idle).toEqual(['sleeper']);
    expect(p.advice.map((a) => [a.roleId, a.kind])).toEqual([
      ['sleeper', 'idle'],
      ['builder', 'expensive'],
      ['tester', 'failing'],
    ]);
    expect(p.advice[0]).toMatchObject({ roleIds: ['sleeper'], message: expect.stringMatching(/^Hasn't worked yet. If that stays true, fire it/) });
    expect(p.advice[1]?.message).toBe('Takes 60% of the spend. Try it on a cheaper model and keep it there if the work holds up.');
  });

  it('waits for some work before calling desks idle, and names them all in one line', () => {
    const quiet = Object.values((() => {
      const s = emptyOffice();
      apply(s, { kind: 'usage', at: 0, sessionId: 's', messageId: 'm', model: 'claude-sonnet-5-5', usage: usage(10) }, index);
      return s.agents;
    })());
    expect(payroll(quiet, studio).advice).toEqual([]);
    const both = { ...studio, roles: [...studio.roles, { id: 'napper', department: 'quality', title: 'Napper' }] };
    const idle = payroll(office(), both).advice.filter((a) => a.kind === 'idle');
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({ roleIds: ['sleeper', 'napper'], message: expect.stringMatching(/^Haven't worked yet. If that stays true, fire them/) });
  });

  it('works with no studio and no agents', () => {
    expect(payroll([], null)).toEqual({ lines: [], rooms: [], idle: [], advice: [], total: { cost: 0, tokens: 0 } });
  });
});

describe("the office's own line", () => {
  const spend = (questions: number, catchUps: number, samples: number, cost: number) => ({
    questions, catchUps, samples, estimated: 0, cost, tokens: 1_000 * (questions + catchUps), usage: { ...usage(100 * (questions + catchUps)), input: 900 * (questions + catchUps) },
  });

  it('comes last whatever it cost, and counts in the total and the shares', () => {
    const p = payroll(office(), studio, [], spend(3, 1, 0, 10));
    expect(p.lines.map((l) => l.id)).toEqual(['builder', 'tester', 'lead', 'Explore', 'office']);
    expect(p.lines.at(-1)).toMatchObject({
      id: 'office', title: 'The office', kind: 'office', department: null, cost: 10, tokens: 4_000, requests: 4, shifts: 4, toolCalls: 0, filesChanged: 0,
    });
    expect(p.total.cost).toBeCloseTo(20, 6);
    expect(p.lines.at(-1)?.share).toBeCloseTo(0.5, 6);
    expect(p.lines[0]?.share).toBeCloseTo(0.3, 6);
  });

  it('stays out of the rooms and the advice', () => {
    const p = payroll(office(), studio, [], spend(3, 1, 0, 10));
    expect(p.rooms.map((r) => [r.id, Number(r.cost.toFixed(6))])).toEqual([['engineering', 6], ['quality', 2]]);
    expect(p.advice.map((a) => [a.roleId, a.kind])).toEqual([['sleeper', 'idle'], ['builder', 'expensive'], ['tester', 'failing']]);
    expect(p.idle).toEqual(['sleeper']);
  });

  it('shows up with the first call, a free demo sample included', () => {
    expect(payroll(office(), studio, [], spend(0, 0, 0, 0)).lines.map((l) => l.id)).not.toContain('office');
    expect(payroll(office(), studio).lines.map((l) => l.id)).not.toContain('office');
    expect(payroll([], null, [], spend(0, 0, 2, 0)).lines).toEqual([expect.objectContaining({ id: 'office', cost: 0, shifts: 2, requests: 0, share: 0 })]);
  });

  it("never merges with a studio role that happens to be called office", () => {
    const withOffice: Studio = { ...studio, roles: [...studio.roles, { id: 'office', department: 'engineering', title: 'Office manager' }] };
    const s = emptyOffice();
    const officeIndex = indexStudio(withOffice);
    apply(s, { kind: 'subagent-start', at: 0, sessionId: 's', agentId: 'o1', agentType: 'office' }, officeIndex);
    apply(s, { kind: 'usage', at: 0, sessionId: 's', agentId: 'o1', agentType: 'office', messageId: 'm', model: 'claude-sonnet-5-5', usage: usage(100_000) }, officeIndex);
    const p = payroll(Object.values(s.agents), withOffice, [], spend(1, 0, 0, 0.5));
    expect(p.lines.map((l) => [l.kind, l.id, l.cost])).toEqual([['role', 'office', 1], ['office', 'office', 0.5]]);
  });
});
