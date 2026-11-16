// What a person's desk loads (src/core/loads.ts): the defaults by level, the checks that treat every assignment as
// untrusted input, the fixed-prompt estimate, and that a proposal and studio.yaml carry `loads` and refuse bad ones.
import { describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { BUILTIN_TOOLS, checkLoads, defaultLoads, estimateLoads, FIXED_PROMPT, resolveLoads, sameLoads } from '../src/core/loads.ts';
import { checkProposal, proposalLoadCosts } from '../src/core/org.ts';
import { parseStudio, serializeStudio } from '../src/core/studio.ts';
import { useApprovalKey } from '../src/org/approved-loads.ts';
import { orgOps } from '../src/org/index.ts';
import { tempDir } from './library-kit.ts';
import { CAFE_PROMPT, cafeProposal, personOf, studioOf } from './org-kit.ts';

// Each case writes a whole studio (agents, rules, skills, the org) to disk and reads it back: about 2 s alone, much
// slower while the full suite saturates the machine.
vi.setConfig({ testTimeout: 120_000 });

const library = loadLibrary();
const check = (raw: unknown, known: Parameters<typeof checkLoads>[3] = {}) => {
  const errors: string[] = [];
  const loads = checkLoads(raw, 'loads', errors, known);
  return { loads, errors };
};

describe('the defaults', () => {
  it('give makers and checkers six tools, and the CEO and managers the four they read and run with', () => {
    expect(defaultLoads('worker')).toEqual({ tools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'], skills: false, mcp: [] });
    for (const level of ['ceo', 'head', 'lead'] as const) expect(defaultLoads(level)).toEqual({ tools: ['Read', 'Bash', 'Glob', 'Grep'], skills: false, mcp: [] });
    // A role from before levels existed is a worker.
    expect(defaultLoads(undefined).tools).toContain('Write');
  });

  it('fill whatever an assignment leaves out, and give a copy each time', () => {
    expect(resolveLoads(undefined, 'head')).toEqual(defaultLoads('head'));
    expect(resolveLoads({ skills: true }, 'worker')).toEqual({ ...defaultLoads('worker'), skills: true });
    expect(resolveLoads({ mcp: ['a'] }, 'ceo').tools).toEqual(['Read', 'Bash', 'Glob', 'Grep']);
    expect(resolveLoads({ tools: ['Grep', 'Read'] }, 'worker').tools).toEqual(['Read', 'Grep']);
    const a = resolveLoads(null, 'worker');
    a.tools.push('Edit');
    expect(defaultLoads('worker').tools).toHaveLength(6);
  });

  it('drop what is not valid when a stored assignment is read, rather than start a desk with it', () => {
    const odd = { tools: ['Read', 'rm -rf', 7, 'Skill'], mcp: ['ok', 'bad name', { x: 1 }, 'ok'] } as never;
    expect(resolveLoads(odd, 'worker')).toEqual({ tools: ['Read'], skills: false, mcp: ['ok'] });
  });

  it('compare two assignments by what they load, not the order they list it in', () => {
    expect(sameLoads(resolveLoads({ tools: ['Grep', 'Read'], mcp: ['b', 'a'] }, 'worker'), resolveLoads({ tools: ['Read', 'Grep'], mcp: ['a', 'b'] }, 'worker'))).toBe(true);
    expect(sameLoads(resolveLoads({ skills: true }, 'worker'), resolveLoads({}, 'worker'))).toBe(false);
  });
});

describe('checking an assignment', () => {
  it('keeps the tools it knows, in the order the list has them, and the skills and servers it is given', () => {
    const known = new Set(['plugin:context7:context7', 'github']);
    expect(check({ tools: ['Grep', 'Read', 'Read', 'WebFetch'], skills: true, mcp: ['github', 'plugin:context7:context7', 'github'] }, { mcp: known })).toEqual({
      loads: { tools: ['Read', 'Grep', 'WebFetch'], skills: true, mcp: ['github', 'plugin:context7:context7'] },
      errors: [],
    });
    expect(check(undefined)).toEqual({ loads: undefined, errors: [] });
    expect(check(null)).toEqual({ loads: undefined, errors: [] });
    expect(check({})).toEqual({ loads: {}, errors: [] });
  });

  it('refuses a tool that is not a built-in on the list, and says where Skill and ToolSearch come from', () => {
    const { errors } = check({ tools: ['Read', 'TodoWrite', 'mcp__org__send', 'Skill', 'ToolSearch', 'bash', 3] });
    expect(errors).toEqual([
      'loads.tools[1]: expected one of ' + `${BUILTIN_TOOLS.join(', ')}, got "TodoWrite"`,
      'loads.tools[2]: expected one of ' + `${BUILTIN_TOOLS.join(', ')}, got "mcp__org__send"`,
      'loads.tools[3]: Skill comes with skills: true, not from tools',
      'loads.tools[4]: ToolSearch comes with an mcp assignment, not from tools',
      'loads.tools[5]: expected one of ' + `${BUILTIN_TOOLS.join(', ')}, got "bash"`,
      'loads.tools[6]: expected one of ' + `${BUILTIN_TOOLS.join(', ')}, got 3`,
    ]);
    expect(check({ tools: 'Read' }).errors[0]).toMatch(/^loads\.tools: expected a list of up to 11 tool names/);
    expect(check({ tools: Array(12).fill('Read') }).errors[0]).toMatch(/^loads\.tools: expected a list of up to 11/);
  });

  it('refuses an MCP server that is not in the catalogue, naming what is installed', () => {
    const known = new Set(['github', 'slack']);
    expect(check({ mcp: ['github', 'jira'] }, { mcp: known }).errors).toEqual(['loads.mcp[1]: "jira" is not an MCP server the user has installed (installed: github, slack)']);
    expect(check({ mcp: ['jira'] }, { mcp: new Set() }).errors).toEqual(['loads.mcp[0]: "jira" is not an MCP server the user has installed (none are)']);
    // Without a catalogue (the browser) only the name's shape is held.
    expect(check({ mcp: ['jira'] }).errors).toEqual([]);
    expect(check({ mcp: ['has space', '', '-x', 'a'.repeat(101), 5, { name: 'x' }] }).errors).toHaveLength(6);
    expect(check({ mcp: Array(13).fill('a') }).errors[0]).toMatch(/^loads\.mcp: expected a list of up to 12/);
  });

  it('refuses a mapping that is not one, skills that are not a boolean and keys it does not know', () => {
    expect(check('Read').errors).toEqual(['loads: expected a mapping with tools, skills or mcp']);
    expect(check(['Read']).errors).toEqual(['loads: expected a mapping with tools, skills or mcp']);
    expect(check({ skills: 'yes' }).errors).toEqual(['loads.skills: expected true or false, got "yes"']);
    expect(check({ env: { A: 'b' } }).errors).toEqual(["loads: unknown field env; a person's loads are tools, skills and mcp"]);
    expect(check({ ['x'.repeat(80)]: 1 }).errors[0]).toMatch(/^loads: unknown field "x{40}"/);
  });
});

describe('the fixed prompt', () => {
  it("is the probe's 13k for a lean desk, and 13k more for the CEO's org tools", () => {
    expect(estimateLoads(undefined, 'worker')).toEqual({ tokens: 13_000, measured: true, parts: [{ what: 'Claude Code and the office', tokens: 13_000, measured: true }] });
    expect(estimateLoads({}, 'head').tokens).toBe(13_000);
    expect(estimateLoads(undefined, 'ceo').tokens).toBe(26_000);
  });

  it('adds 3k for the Skill tool, and an estimate marked as such for each MCP server and for tool search', () => {
    const skills = estimateLoads({ skills: true }, 'worker');
    expect(skills).toMatchObject({ tokens: 16_000, measured: true });
    const mcp = estimateLoads({ mcp: ['a', 'b'] }, 'worker');
    expect(mcp.tokens).toBe(13_000 + FIXED_PROMPT.toolSearch + 2 * FIXED_PROMPT.mcpServer);
    expect(mcp.measured).toBe(false);
    expect(mcp.parts.filter((p) => !p.measured).map((p) => p.what)).toEqual(['tool search', 'a', 'b']);
    expect(mcp.parts.filter((p) => p.measured).map((p) => p.what)).toEqual(['Claude Code and the office']);
  });

  it('adds up per person for a proposal', () => {
    const raw = cafeProposal();
    personOf(raw, 'copywriter').loads = { skills: true };
    personOf(raw, 'ui-designer').loads = { mcp: ['figma'] };
    const result = checkProposal(raw, { libraryRoles: new Set(library.roles.keys()), enforceSize: false });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const { byPerson, tokens } = proposalLoadCosts(result.proposal);
    expect(byPerson.ceo?.tokens).toBe(26_000);
    expect(byPerson.copywriter?.tokens).toBe(16_000);
    expect(byPerson['ui-designer']?.measured).toBe(false);
    expect(byPerson.copywriter?.parts.map((p) => p.what)).toEqual(['Claude Code and the office', 'skills']);
    expect(tokens).toBe(Object.values(byPerson).reduce((n, c) => n + c.tokens, 0));
    expect(Object.keys(byPerson)).toHaveLength(result.proposal.people.length);
    // A person called "constructor" or "__proto__" can't be a proposal's id here, and the table has no prototype anyway.
    expect(Object.getPrototypeOf(byPerson)).toBeNull();
  });
});

describe('in a proposal', () => {
  const known = { libraryRoles: new Set(library.roles.keys()), mcpServers: new Set(['github', 'plugin:context7:context7']), preset: 'thorough' as const };

  it('is kept on the person who has it, and left off the ones who have none', () => {
    const raw = cafeProposal();
    personOf(raw, 'backend-engineer').loads = { tools: ['Grep', 'Read', 'Bash'], skills: true, mcp: ['github'] };
    const result = checkProposal(raw, known);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const people = result.proposal.people;
    expect(people.find((p) => p.id === 'backend-engineer')?.loads).toEqual({ tools: ['Read', 'Bash', 'Grep'], skills: true, mcp: ['github'] });
    expect(people.filter((p) => p.loads !== undefined).map((p) => p.id)).toEqual(['backend-engineer']);
  });

  it('names the person and the field when a tool or a server is not allowed', () => {
    const raw = cafeProposal();
    personOf(raw, 'backend-engineer').loads = { tools: ['Read', 'TodoWrite'], mcp: ['jira'] };
    const result = checkProposal(raw, known);
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.errors;
    const at = cafeProposal().people.findIndex((p) => p.id === 'backend-engineer');
    expect(errors).toEqual([
      `people[${at}].loads.tools[1]: expected one of ${BUILTIN_TOOLS.join(', ')}, got "TodoWrite"`,
      `people[${at}].loads.mcp[0]: "jira" is not an MCP server the user has installed (installed: github, plugin:context7:context7)`,
    ]);
  });

  it('is checked against the catalogue the server reads, through the org operations', () => {
    const ops = orgOps(library, () => new Set(['github']));
    const raw = cafeProposal();
    personOf(raw, 'backend-engineer').loads = { mcp: ['github'] };
    expect(ops.check(raw, { preset: 'thorough' }).ok).toBe(true);
    personOf(raw, 'backend-engineer').loads = { mcp: ['slack'] };
    const refused = ops.check(raw, { preset: 'thorough' });
    expect(refused.ok ? '' : refused.errors[0]).toContain('"slack" is not an MCP server the user has installed (installed: github)');
    // The stakeholder's edits are held to the catalogue too; only the size rules are lifted.
    expect(ops.check(raw, { enforceSize: false }).ok).toBe(false);
  });
});

describe('in studio.yaml', () => {
  const yaml = (extra: string) =>
    ['version: 1', 'name: Acme', 'domain: custom', 'rigor: lean', 'departments:', '  - id: engineering', '    name: Engineering', 'roles:', '  - id: maker', '    department: engineering', '    title: Maker', extra].join('\n');

  it('round-trips, and a role without it stays without it', () => {
    const parsed = parseStudio(yaml('    loads:\n      tools: [Read, Grep]\n      skills: true\n      mcp: [github]'));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.studio.roles[0]?.loads).toEqual({ tools: ['Read', 'Grep'], skills: true, mcp: ['github'] });
    const again = parseStudio(serializeStudio(parsed.studio));
    expect(again).toEqual(parsed);
    const plain = parseStudio(yaml(''));
    expect(plain.ok && plain.studio.roles[0]).not.toHaveProperty('loads');
  });

  it('refuses a hand edit that names a tool that does not exist or a key it does not know', () => {
    const bad = parseStudio(yaml('    loads:\n      tools: [Read, Shell]\n      env: x'));
    expect(bad).toEqual({
      ok: false,
      errors: ["roles[0].loads: unknown field env; a person's loads are tools, skills and mcp", `roles[0].loads.tools[1]: expected one of ${BUILTIN_TOOLS.join(', ')}, got "Shell"`],
    });
  });
});

describe('written with the org', () => {
  it('lands in studio.yaml, survives a hire, a fire and a rehire, and is kept when a later proposal says nothing', () => {
    const ops = orgOps(library, () => new Set(['github']));
    const root = tempDir();
    // The hub names its key for every company it opens; the approved record is signed with it (src/org/approved-loads.ts).
    useApprovalKey(root, new Uint8Array(32).fill(5));
    ops.found(root, CAFE_PROMPT);
    const raw = cafeProposal();
    personOf(raw, 'backend-engineer').loads = { skills: true, mcp: ['github'] };
    const first = ops.check(raw, { preset: 'thorough' });
    if (!first.ok) throw new Error(first.errors.join('\n'));
    ops.write(root, first.proposal);
    expect(studioOf(root).roles.find((r) => r.id === 'backend-engineer')?.loads).toEqual({ skills: true, mcp: ['github'] });
    expect(studioOf(root).roles.filter((r) => r.loads !== undefined).map((r) => r.id)).toEqual(['backend-engineer']);

    // Another change to the org rewrites the manifest: the assignment stays.
    ops.hire(root, { role: 'privacy-officer', room: 'content', reportsTo: 'head-of-content', name: null, title: null });
    expect(studioOf(root).roles.find((r) => r.id === 'backend-engineer')?.loads).toEqual({ skills: true, mcp: ['github'] });

    ops.fire(root, 'backend-engineer');
    expect(studioOf(root).fired.find((f) => f.id === 'backend-engineer')?.loads).toEqual({ skills: true, mcp: ['github'] });
    ops.rehire(root, 'backend-engineer');
    expect(studioOf(root).roles.find((r) => r.id === 'backend-engineer')?.loads).toEqual({ skills: true, mcp: ['github'] });

    // A proposal that leaves `loads` out doesn't take the assignment away from someone who had it.
    const again = ops.check(cafeProposal(), { preset: 'thorough' });
    if (!again.ok) throw new Error(again.errors.join('\n'));
    ops.write(root, again.proposal);
    expect(studioOf(root).roles.find((r) => r.id === 'backend-engineer')?.loads).toEqual({ skills: true, mcp: ['github'] });
  });

  it('refuses a server that is no longer installed, and writes nothing', () => {
    const ops = orgOps(library, () => new Set());
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    const raw = cafeProposal();
    personOf(raw, 'backend-engineer').loads = { mcp: ['github'] };
    const result = checkProposal(raw, { libraryRoles: new Set(library.roles.keys()), enforceSize: false });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(() => ops.write(root, result.proposal)).toThrow(/is not an MCP server the user has installed \(none are\)/);
  });
});
