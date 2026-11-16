// The installed catalogue in a company's view (spending.catalogue): there for the proposal's multi-select while the company
// is founding or proposed, gone once it starts, and never anything that could be a secret.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoCompanyView, demoFoundingView, demoProposalView } from '../src/core/demo-company.ts';
import { proposal, rig } from './company-kit.ts';
import { tempDir } from './library-kit.ts';

const SECRET = 'sk-test-SECRET-0123456789';

/** A ~/.claude with a server whose configuration holds secrets, one the user denied, and a skill of their own. */
function userFiles(): Record<string, string> {
  const dir = tempDir('worklings-catalogue-');
  writeFileSync(
    join(dir, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        github: { type: 'http', url: `https://api.example.test/mcp?key=${SECRET}`, headers: { Authorization: `Bearer ${SECRET}` } },
        notes: { command: 'node', args: ['notes-server.js', SECRET], env: { NOTES_TOKEN: SECRET } },
        blocked: { command: 'node' },
      },
    }),
  );
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ deniedMcpServers: [{ serverName: 'blocked' }] }));
  mkdirSync(join(dir, 'skills', 'kickoff'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'kickoff', 'SKILL.md'), '# kickoff');
  return { CLAUDE_CONFIG_DIR: dir };
}

describe('spending.catalogue', () => {
  it('carries the installed servers, one line each, while the company is founding and while it is proposed', async () => {
    const { company } = await rig({ env: userFiles() });
    expect(company.view().phase).toBe('founding');
    const expected = {
      mcp: [
        { name: 'github', summary: 'A server you added yourself (github), runs over the web', kind: 'remote' },
        { name: 'notes', summary: 'A server you added yourself (notes), runs on this machine', kind: 'local' },
      ],
      skills: 1,
    };
    expect(company.view().spending?.catalogue).toEqual(expected);
    expect(company.proposeOrg('ceo', proposal()).ok).toBe(true);
    expect(company.view().phase).toBe('proposed');
    expect(company.view().spending?.catalogue).toEqual(expected);
  });

  it('is gone once the company has started', async () => {
    const { company } = await rig({ running: true, env: userFiles() });
    expect(company.view().phase).toBe('running');
    expect(company.view().spending?.catalogue).toBeNull();
  });

  it('keeps denied servers out, and holds nothing secret: no command, address, header or environment value, not even in the whole view', async () => {
    const { company } = await rig({ env: userFiles() });
    const view = company.view();
    const names = view.spending?.catalogue?.mcp.map((m) => m.name);
    expect(names).not.toContain('blocked');
    const text = JSON.stringify(view);
    for (const secret of [SECRET, 'api.example.test', 'notes-server.js', 'NOTES_TOKEN', 'Authorization']) expect(text).not.toContain(secret);
    for (const entry of view.spending?.catalogue?.mcp ?? []) expect(Object.keys(entry).sort()).toEqual(['kind', 'name', 'summary']);
  });

  it('is an empty list, not missing, for a user with nothing installed', async () => {
    const { company } = await rig({ env: { CLAUDE_CONFIG_DIR: tempDir('worklings-catalogue-') } });
    expect(company.view().spending?.catalogue).toEqual({ mcp: [], skills: 0 });
  });

  it('is in the demo view with two made-up entries, before the start only', () => {
    expect(demoFoundingView(0).spending?.catalogue?.mcp).toHaveLength(2);
    expect(demoProposalView(0).spending?.catalogue?.mcp).toHaveLength(2);
    expect(demoCompanyView(0).spending?.catalogue).toBeNull();
  });
});
