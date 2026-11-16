// What the approvals policy does with MCP tools: the office's own, by exact name, and everything else (a server the user
// assigned to a person) asking first, with Always allow for the server.
import { describe, expect, it } from 'vitest';
import { ORG_TOOLS, toolsFor } from '../src/core/company.ts';
import { STEERING_TOOLS } from '../src/core/steering.ts';
import { classifyPermission, orgToolRules, type PermissionVerdict, type PolicyOptions } from '../src/runtime/approvals.ts';

const policy = (o: Partial<PolicyOptions> = {}): PolicyOptions => ({ root: process.cwd(), branch: 'worklings/acme', rules: [], home: process.cwd(), tmp: process.cwd(), ...o });
const tool = (name: string, input: Record<string, unknown> = {}, o?: Partial<PolicyOptions>): PermissionVerdict =>
  classifyPermission({ hook_event_name: 'PermissionRequest', tool_name: name, tool_input: input, cwd: process.cwd() }, policy(o));

describe('the office’s own tools', () => {
  it('are allowed by their exact names, every one the office serves', () => {
    for (const name of [...Object.values(ORG_TOOLS).flat(), ...Object.values(STEERING_TOOLS).flat()]) expect(tool(`mcp__org__${name}`), name).toEqual({ verdict: 'allow' });
  });

  it('are the only thing mcp__org allows: a tool the office doesn’t have is refused, not allowed or asked', () => {
    for (const name of ['mcp__org__evil', 'mcp__org__', 'mcp__org', 'mcp__org__report_extra', 'mcp__org__Report']) {
      expect(tool(name), name).toMatchObject({ verdict: 'deny' });
    }
    // A server whose name only starts like the office's is an ordinary server, and asks.
    expect(tool('mcp__organic__get_thing')).toMatchObject({ verdict: 'ask' });
    expect(tool('mcp__org_x__get_thing')).toMatchObject({ verdict: 'ask' });
  });

  it('are allowed to the desk by exact names, for the tools its person has, never a bare server', () => {
    const worker = orgToolRules({ id: 'ada', level: 'worker' });
    expect(worker).toContain('mcp__org__report');
    expect(worker).toContain('mcp__org__ack');
    expect(worker).not.toContain('mcp__org__assign');
    expect(worker).not.toContain('mcp__org__propose_plan');
    expect(orgToolRules({ id: 'ben', level: 'head' })).toEqual(expect.arrayContaining(['mcp__org__assign', 'mcp__org__steer_task']));
    const ceo = orgToolRules({ id: 'ceo', level: 'ceo' });
    expect(ceo).toEqual(expect.arrayContaining(['mcp__org__propose_org', 'mcp__org__propose_plan', ...toolsFor({ id: 'ceo', level: 'ceo' }).map((t) => `mcp__org__${t}`)]));
    expect(worker).not.toContain('mcp__org__mark_checklist');
    expect(ceo).toContain('mcp__org__mark_checklist');
    expect(orgToolRules({ id: 'qa-engineer', level: 'worker', title: 'QA engineer' })).toContain('mcp__org__mark_checklist');
    for (const rule of [...worker, ...ceo]) expect(rule).toMatch(/^mcp__org__[a-z_]+$/);
  });
});

describe('a server the user assigned', () => {
  it('asks on first use, whatever its tools are called: get, fetch and export are not read-only because of their names', () => {
    for (const name of ['get_file', 'fetch_url', 'export_everything', 'list_projects', 'search', 'download_all', 'take_screenshot']) {
      const v = tool(`mcp__plugin_expo_expo__${name}`);
      expect(v, name).toMatchObject({ verdict: 'ask', kind: 'other', alwaysRule: { rule: 'mcp__plugin_expo_expo' } });
    }
  });

  it('is allowed as a whole once the stakeholder chose Always allow for the server, and not before', () => {
    const rules = ['mcp__github'];
    expect(tool('mcp__github__get_issue', {}, { rules })).toEqual({ verdict: 'allow' });
    expect(tool('mcp__github__create_branch', {}, { rules })).toEqual({ verdict: 'allow' });
    // Another server is another question.
    expect(tool('mcp__gitlab__get_issue', {}, { rules })).toMatchObject({ verdict: 'ask' });
  });

  it('asks about spending, sending and deleting under their own kinds, with an Always allow for the tool alone', () => {
    expect(tool('mcp__shop__create_checkout')).toMatchObject({ verdict: 'ask', kind: 'paid-api', alwaysRule: { rule: 'mcp__shop__create_checkout' } });
    expect(tool('mcp__mail__send_email')).toMatchObject({ verdict: 'ask', kind: 'message-out', alwaysRule: { rule: 'mcp__mail__send_email' } });
    expect(tool('mcp__files__delete_file')).toMatchObject({ verdict: 'ask', kind: 'other', alwaysRule: { rule: 'mcp__files__delete_file' } });
    // A server-wide Always allow, once given, covers them (it is the stakeholder's to give); a tool-wide one covers only that tool.
    expect(tool('mcp__mail__send_email', {}, { rules: ['mcp__mail__send_email'] })).toEqual({ verdict: 'allow' });
    expect(tool('mcp__mail__delete_mail', {}, { rules: ['mcp__mail__send_email'] })).toMatchObject({ verdict: 'ask' });
  });

  it('still asks for a write under .claude/, which no Always allow for a server reaches', () => {
    expect(tool('Write', { file_path: `${process.cwd()}/.claude/settings.json`, content: '{}' }, { rules: ['mcp__github'] })).toMatchObject({ verdict: 'ask' });
  });
});
