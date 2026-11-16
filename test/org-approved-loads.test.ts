// What a role may load is what the stakeholder approved, not what a project file says (src/org/approved-loads.ts): the
// record made when the org is written, a studio.yaml changed afterwards, and a company's desk plan for the changed file.
// The record is signed with the hub's key, so one written by hand, by a desk or by an earlier build grants nothing.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { parseStudio, serializeStudio } from '../src/core/studio.ts';
import { approvedLoads, recordApproved, useApprovalKey } from '../src/org/approved-loads.ts';
import { orgOps } from '../src/org/index.ts';
import { rig } from './company-kit.ts';
import { tempDir } from './library-kit.ts';
import { CAFE_PROMPT, cafeProposal, personOf, studioOf } from './org-kit.ts';

// Each case writes a whole studio (agents, rules, skills, the org) to disk and reads it back: about 2 s alone, much
// slower while the full suite saturates the machine.
vi.setConfig({ testTimeout: 120_000 });

const library = loadLibrary();
const ops = orgOps(library, () => new Set(['github', 'slack']));
const record = (root: string) => JSON.parse(readFileSync(join(root, '.worklings', 'approved-loads.json'), 'utf8')) as { version: number; roles: Record<string, unknown>; mac: string };
/** The hub's key in these tests; the hub names its own for each company it opens. */
const KEY = new Uint8Array(32).fill(3);
/** A company folder the hub has named its key for. */
const keyed = (): string => {
  const root = tempDir();
  useApprovalKey(root, KEY);
  return root;
};

/** A café company the stakeholder started, with the CEO's assignment for one engineer. */
function started(loads: object = { skills: true, mcp: ['github'] }): string {
  const root = keyed();
  ops.found(root, CAFE_PROMPT);
  const raw = cafeProposal();
  personOf(raw, 'backend-engineer').loads = loads;
  const checked = ops.check(raw, { preset: 'thorough' });
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  ops.write(root, checked.proposal);
  return root;
}

/** Edits studio.yaml the way a pull request could. */
function tamper(root: string, change: (roles: ReturnType<typeof studioOf>['roles']) => void): void {
  const studio = studioOf(root);
  change(studio.roles);
  writeFileSync(join(root, '.claude', 'studio.yaml'), serializeStudio(studio));
}

describe('the record', () => {
  it('is written with the org, holds only the roles that load something, and sits in the company’s own state', () => {
    const root = started();
    expect(record(root)).toEqual({ version: 2, roles: { 'backend-engineer': { skills: true, mcp: ['github'] } }, mac: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(existsSync(join(root, '.worklings'))).toBe(true);
  });

  it('is replaced by the next org the stakeholder approves, and a role dropped from it is dropped from the record', () => {
    const root = started();
    const raw = cafeProposal();
    personOf(raw, 'backend-engineer').loads = { mcp: ['slack'] };
    personOf(raw, 'copywriter').loads = { skills: true };
    const checked = ops.check(raw, { preset: 'thorough' });
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    ops.write(root, checked.proposal);
    expect(record(root).roles).toEqual({ 'backend-engineer': { mcp: ['slack'] }, copywriter: { skills: true } });
  });

  it('is kept when a later proposal says nothing about a role the stakeholder had approved', () => {
    const root = started();
    const checked = ops.check(cafeProposal(), { preset: 'thorough' });
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    ops.write(root, checked.proposal);
    expect(studioOf(root).roles.find((r) => r.id === 'backend-engineer')?.loads).toEqual({ skills: true, mcp: ['github'] });
    expect(record(root).roles).toEqual({ 'backend-engineer': { skills: true, mcp: ['github'] } });
  });

  it('does not take a studio.yaml’s own assignment as approved when a later proposal says nothing', () => {
    const root = started();
    tamper(root, (roles) => {
      const role = roles.find((r) => r.id === 'copywriter');
      if (role) role.loads = { mcp: ['slack'] };
    });
    const checked = ops.check(cafeProposal(), { preset: 'thorough' });
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    ops.write(root, checked.proposal);
    expect(studioOf(root).roles.find((r) => r.id === 'copywriter')?.loads).toBeUndefined();
    expect(record(root).roles).not.toHaveProperty('copywriter');
  });
});

describe('a studio.yaml that was changed', () => {
  const said = () => {
    const lines: string[] = [];
    return { lines, say: (s: string) => lines.push(s) };
  };

  it('gives a role what was approved, in any order, and says nothing', () => {
    const root = started({ tools: ['Read', 'Grep'], mcp: ['github', 'slack'] });
    const { lines, say } = said();
    const role = studioOf(root).roles.find((r) => r.id === 'backend-engineer');
    expect(approvedLoads(root, role && { ...role, loads: { mcp: ['slack', 'github'], tools: ['Grep', 'Read'] } }, say)).toEqual({ mcp: ['slack', 'github'], tools: ['Grep', 'Read'] });
    expect(lines).toEqual([]);
  });

  it('gives the level’s defaults, and says so once, when a role is given tools or servers the stakeholder never saw', () => {
    const root = started();
    tamper(root, (roles) => {
      const role = roles.find((r) => r.id === 'backend-engineer');
      if (role) role.loads = { tools: ['Read', 'Edit', 'Write', 'Bash', 'WebFetch'], mcp: ['github', 'slack'], skills: true };
    });
    const { lines, say } = said();
    const role = studioOf(root).roles.find((r) => r.id === 'backend-engineer');
    expect(approvedLoads(root, role, say)).toBeUndefined();
    expect(approvedLoads(root, role, say)).toBeUndefined();
    expect(lines).toEqual(["The tools and servers .claude/studio.yaml gives backend-engineer weren't approved by the stakeholder, so backend-engineer's desk gets the standard ones for their level."]);
  });

  it('does the same for a role that had nothing approved and now has something', () => {
    const root = started();
    tamper(root, (roles) => {
      const role = roles.find((r) => r.id === 'copywriter');
      if (role) role.loads = { mcp: ['slack'] };
    });
    const { lines, say } = said();
    expect(approvedLoads(root, studioOf(root).roles.find((r) => r.id === 'copywriter'), say)).toBeUndefined();
    expect(lines).toHaveLength(1);
  });

  it('is not fooled by a record that is missing, unreadable, or not a record at all', () => {
    const loads = { skills: true };
    const role = { id: 'x', level: 'worker' as const, loads };
    const root = keyed();
    expect(approvedLoads(root, role)).toBeUndefined();
    recordApproved(root, [role]);
    expect(approvedLoads(root, role)).toEqual(loads);
    for (const junk of ['not json', '[1]', '{"roles": 5}', '{"roles": ["x"]}', '{"roles": {"x": 7}}', '']) {
      writeFileSync(join(root, '.worklings', 'approved-loads.json'), junk);
      expect(approvedLoads(root, role), junk).toBeUndefined();
    }
    // A role whose file loads only what its level loads anyway is the same as having nothing approved.
    const same = { id: 'x', level: 'worker' as const, loads: { tools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'] } };
    expect(approvedLoads(root, same)).toEqual(same.loads);
    expect(approvedLoads(root, { id: 'x' })).toBeUndefined();
    expect(approvedLoads(root, undefined)).toBeUndefined();
  });

  it('grants nothing from a record that is unsigned, forged, signed for another folder or written without the key', () => {
    const role = { id: 'x', level: 'worker' as const, loads: { skills: true, mcp: ['github'] } };
    const root = keyed();
    const file = join(root, '.worklings', 'approved-loads.json');
    const { lines, say } = said();
    // As a desk or a pull request would write it, in the format builds before the signature wrote.
    mkdirSync(join(root, '.worklings'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, roles: { x: role.loads } }));
    expect(approvedLoads(root, role, say)).toBeUndefined();
    expect(lines).toEqual([
      "The record of what each desk may load (.worklings/approved-loads.json) isn't one this computer's Worklings signed (it was changed by hand, or written by an earlier build), so x's desk gets the standard tools and servers for their level until the stakeholder approves the org again.",
    ]);
    // Signed, then given more than was approved.
    recordApproved(root, [{ ...role, loads: { skills: true } }]);
    const signed = record(root);
    writeFileSync(file, JSON.stringify({ ...signed, roles: { x: role.loads } }));
    expect(approvedLoads(root, role)).toBeUndefined();
    // A mac made with another key.
    const other = tempDir();
    useApprovalKey(other, new Uint8Array(32).fill(9));
    recordApproved(other, [role]);
    expect(approvedLoads(other, role)).toEqual(role.loads);
    copyFileSync(join(other, '.worklings', 'approved-loads.json'), file);
    expect(approvedLoads(root, role)).toBeUndefined();
    // A record signed with this key for another company's folder.
    const twin = keyed();
    recordApproved(twin, [role]);
    copyFileSync(join(twin, '.worklings', 'approved-loads.json'), file);
    expect(approvedLoads(root, role)).toBeUndefined();
    // A folder the hub named no key for: nothing is written, and nothing counts.
    const unkeyed = tempDir();
    recordApproved(unkeyed, [role]);
    expect(existsSync(join(unkeyed, '.worklings', 'approved-loads.json'))).toBe(false);
    expect(approvedLoads(unkeyed, role)).toBeUndefined();
  });

  it('does not take a role id that is a prototype key for an approved role', () => {
    const root = started();
    for (const id of ['__proto__', 'constructor', 'toString']) expect(approvedLoads(root, { id, loads: { skills: true } })).toBeUndefined();
  });
});

describe('a company’s desk plan', () => {
  it('uses a role’s loads only when they are what the stakeholder approved, and says in the log when they are not', async () => {
    const { desks, root, reopen, warnings } = await rig({ running: true });
    const base = parseStudio(readFileSync(join(root, '.claude', 'studio.yaml'), 'utf8'));
    if (!base.ok) throw new Error(base.errors.join('\n'));
    const set = (loads: object) => {
      const studio = structuredClone(base.studio);
      const role = studio.roles.find((r) => r.id === 'ui-designer');
      if (role) role.loads = loads;
      writeFileSync(join(root, '.claude', 'studio.yaml'), serializeStudio(studio));
    };
    const planNow = () => {
      reopen().say('ui-designer', 'Make the palette darker.');
      return desks().turns.at(-1)?.plan;
    };

    // A file nobody approved.
    set({ skills: true, mcp: ['github'] });
    expect(planNow()?.loads).toBeUndefined();
    expect(warnings.filter((w) => w.includes("ui-designer weren't approved by the stakeholder"))).toHaveLength(1);

    // The same file once the stakeholder's approval is on record.
    recordApproved(root, [{ id: 'ui-designer', level: 'worker', loads: { skills: true, mcp: ['github'] } }]);
    expect(planNow()?.loads).toEqual({ skills: true, mcp: ['github'] });

    // And a file changed again after that goes back to the defaults.
    set({ skills: true, mcp: ['github', 'slack'] });
    expect(planNow()?.loads).toBeUndefined();
  });

  it('puts a desk notice (a desk that came up the standard way, and why) in the company’s log', async () => {
    const { desks, warnings } = await rig({ running: true });
    desks().events.notice?.('Desks start with your whole Claude Code setup instead of the lean one, because a test said so. They are heavier, and nothing you set up is left out.');
    expect(warnings).toEqual(['Desks start with your whole Claude Code setup instead of the lean one, because a test said so. They are heavier, and nothing you set up is left out.']);
  });
});
