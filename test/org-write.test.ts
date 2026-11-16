import { presetGuidance } from '../src/core/presets.ts';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { compose } from '../src/composer/compose.ts';
import { detect } from '../src/composer/detect.ts';
import { lintLibrary, loadLibrary } from '../src/composer/library.ts';
import { writePlan } from '../src/composer/write.ts';
import { OrgRefusal } from '../src/core/company.ts';
import { parseFrontmatter } from '../src/core/frontmatter.ts';
import type { OrgProposal } from '../src/core/org.ts';
import { orgOps } from '../src/org/index.ts';
import { readAgents } from '../src/server/project.ts';
import { tempDir, writeTree } from './library-kit.ts';
import { CAFE_PROMPT, cafeProposal, personOf, read, studioOf, TWINT_ROLE } from './org-kit.ts';
import { project } from './projects.ts';

// Each case writes a whole studio (agents, rules, skills, the org) to disk and reads it back: about 2 s alone, much
// slower while the full suite saturates the machine.
vi.setConfig({ testTimeout: 120_000 });

const library = loadLibrary();
const ops = orgOps(library);

/** The café org, checked as the company checks the CEO's proposal. */
function cafe(change: (p: ReturnType<typeof cafeProposal>) => void = () => {}): OrgProposal {
  const raw = cafeProposal();
  change(raw);
  const checked = ops.check(raw, { preset: 'thorough' });
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  return checked.proposal;
}

/** A project with the studio v1's composer writes for a standard web app. */
function v1Project(): string {
  const root = project('webApp');
  writePlan(root, compose({ library, domain: 'web-app', rigor: 'standard', detection: detect(root, library), version: '0.1.0' }));
  return root;
}

/** Every file in a folder and its text, to show a refused change left everything as it was. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const path = join(root, entry);
    if (statSync(path).isFile()) files[entry.replaceAll('\\', '/')] = readFileSync(path, 'utf8');
  }
  return files;
}

const agentOf = (root: string, id: string) => parseFrontmatter(read(root, `.claude/agents/${id}.md`));
const refusal = (work: () => unknown): OrgRefusal => {
  try {
    work();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

describe('founding a company', () => {
  it('gives an empty folder a studio with only its CEO, written like v1 writes one', () => {
    const root = tempDir();
    const result = ops.found(root, CAFE_PROMPT);
    expect(result).toEqual({
      ok: true,
      message: 'Founded the company with its CEO in Direction. The CEO drafts the org from your prompt.',
      changed: ['.claude/agents/ceo.md', '.claude/studio.yaml', 'CLAUDE.md'],
    });
    const studio = studioOf(root);
    // The generator is this package, at its own version.
    const version = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
    expect(studio).toMatchObject({ name: basename(root), domain: 'custom', fired: [], generator: { tool: 'worklings', version } });
    expect(studio.departments).toEqual([{ id: 'direction', name: 'Direction', style: 'direction' }]);
    expect(studio.roles).toEqual([{ id: 'ceo', department: 'direction', title: 'CEO', level: 'ceo', archetype: 'ceo' }]);
    expect(studio.office).toBeUndefined();

    const ceo = agentOf(root, 'ceo');
    expect(ceo.data).toEqual({ name: 'ceo', description: library.roles.get('ceo')?.description, model: 'inherit', color: 'purple' });
    expect(ceo.body).toContain(library.roles.get('ceo')?.body ?? 'the ceo role');
    expect(ceo.body).toContain(`- **What it is:** ${CAFE_PROMPT}`);
    expect(ceo.body).toContain('- **Your studio:** just you and the lead.');
    expect(ceo.body).toContain('\n## Hand off\n- Everything else goes back to the stakeholder with what you did, how you checked it and what is left.\n');
    expect(ceo.body).toMatch(/<!-- worklings:notes -->\n- You are the CEO\. You report to the stakeholder\.\n<!-- \/worklings:notes -->\n$/);

    const claude = read(root, 'CLAUDE.md');
    expect(claude).toMatch(/^<!-- worklings:start -->\n## Studio\n/);
    expect(claude).toContain(`This project is run by ${basename(root)}, a Worklings company being founded: its CEO is drafting the org for the stakeholder.`);
    expect(claude).toContain('| Direction | `ceo` | Builds and runs the company for the stakeholder: scopes the first prompt with a few questions, drafts an org sized to the goal and proposes it,');
  });

  it('changes nothing when it runs again', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    const before = snapshot(root);
    expect(ops.found(root, CAFE_PROMPT).changed).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('puts the CEO first in a studio the project already has, and keeps everyone else', () => {
    const root = v1Project();
    const roles = studioOf(root).roles.map((r) => r.id);
    const result = ops.found(root, CAFE_PROMPT);
    expect(result.message).toBe(`Founded the company with its CEO in Direction, next to the ${roles.length} roles already here, who stay until the org is written. The CEO drafts the org from your prompt.`);
    const studio = studioOf(root);
    expect(studio.roles.map((r) => r.id)).toEqual(['ceo', ...roles]);
    expect(studio.departments[0]).toEqual({ id: 'direction', name: 'Direction', style: 'direction' });
    // CLAUDE.md keeps one block, now the company's.
    const claude = read(root, 'CLAUDE.md');
    expect(claude.match(/<!-- worklings:start -->/g)).toHaveLength(1);
    expect(claude).toContain('| Engineering | `frontend-engineer` | Builds and fixes the web front end:');
    // The roles already there keep the files the composer wrote them, closing line and all.
    expect(read(root, '.claude/agents/frontend-engineer.md')).toContain('- Everything else goes back to the lead (the main session) with what you did');
  });

  it('imports AGENTS.md into the CLAUDE.md it makes, as the composer does', () => {
    const root = writeTree(tempDir(), { 'AGENTS.md': '# Shared rules\n' });
    ops.found(root, CAFE_PROMPT);
    expect(read(root, 'CLAUDE.md')).toMatch(/^@AGENTS\.md\n\n<!-- worklings:start -->\n/);
  });

  it('changes nothing while studio.yaml has a mistake', () => {
    const root = v1Project();
    const manifest = join(root, '.claude/studio.yaml');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('department: design', 'department: desgin'));
    const before = snapshot(root);
    expect(refusal(() => ops.found(root, CAFE_PROMPT)).message).toMatch(/^\.claude\/studio\.yaml has a problem, so nothing was changed: roles\[/);
    expect(snapshot(root)).toEqual(before);
  });
});

describe('the CEO’s first turn', () => {
  it('quotes the prompt, says what was found and what to do', () => {
    expect(ops.openingTurn({ prompt: `${CAFE_PROMPT}\nTWINT at pickup`, detected: 'An empty folder: nothing is built yet.', studio: null })).toBe(
      [
        'You are founding a new company, and its first task is the org. The stakeholder asked for this:',
        '',
        `> ${CAFE_PROMPT}`,
        '> TWINT at pickup',
        '',
        'What detection found in the project folder: An empty folder: nothing is built yet.',
        '',
        ...presetGuidance('balanced', false),
        'The office asks the stakeholder "How thorough?" itself, with the three presets and what each costs, so do not ask about size, cost or thoroughness; if they pick another preset, the office tells you and you revise.',
        '',
        'Now:',
        '1. Read the request for what it settles. When it is short, vague or leaves real choices open (who it is for, the scope and ' +
          'ambition, the platforms, the quality bar, constraints and must-haves), your first move is ask_scoping: three to five ' +
          'questions (at most three when the job looks small), each with two to four options, your pick and a line on why. Your pick is ' +
          "the simplest option that satisfies the request, never a feature it didn't ask for; extras are options that aren't your pick. Then end your turn: the answers come to you in " +
          'one message, and you draft from them. When the request already settles these, go on to 2 with fewer questions or none.',
        '2. Call library_catalogue for the roles you can hire.',
        '3. Judge the size first, from the job\'s parts: small (you and one maker, for one deliverable: a script, a CLI or a one-page tool), ' +
          'medium (you and 2 to 4 makers, flat, for two to four independent streams) or large (5 or more makers, for five or more streams; ' +
          'heads only when more than 6 makers need briefing, each briefing 3 or more). Pick at or under what the preset above allows, and send the org with propose_org, with size and ' +
          'the reason in sizing. Everyone reports to you unless a head exists. Name the company after what the stakeholder is building, not the folder. Give every niche area the work ' +
          'implies its own specialist, and write the role when the library has only a generic one (a TWINT payments engineer ' +
          'rather than a backend engineer, local search for a local business). If it is refused, fix what each sentence names and ' +
          'send it again.',
        "4. Put the decisions that are still the stakeholder's in the proposal's questions, each with two to four options and your pick.",
        'Then wait for the stakeholder, who reads the chart, may ask for changes, and starts the company.',
      ].join('\n'),
    );
  });

  it('names the roles of a studio the project has, and what happens to them', () => {
    const root = v1Project();
    ops.found(root, CAFE_PROMPT);
    const turn = ops.openingTurn({ prompt: CAFE_PROMPT, detected: 'A project called itinerary.', studio: studioOf(root) });
    expect(turn).toContain('The project already has a studio of 9 roles: frontend-engineer (frontend engineer), backend-engineer (backend engineer),');
    expect(turn).toContain('Keep the ones the work needs under the same ids; those you leave out are fired when the company starts, and can be rehired.');
    expect(turn).not.toContain('ceo (');
  });
});

describe('the library catalogue', () => {
  it('lists every library role, the org flow’s own included, room by room', () => {
    const entries = ops.catalogue();
    expect(entries).toHaveLength(library.roles.size);
    expect(entries.find((e) => e.id === 'head')).toEqual({
      id: 'head',
      title: 'Head of department',
      department: 'direction',
      description: library.roles.get('head')?.description,
      model: 'inherit',
    });
    expect(entries.map((e) => e.id)).toEqual(expect.arrayContaining(['ceo', 'office-manager', 'seo-specialist']));
    expect(entries[0]?.department).toBe('direction');
    expect(entries.at(-1)?.department).toBe('ops');
  });
});

describe('writing the org', () => {
  function company(): string {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    ops.write(root, cafe());
    return root;
  }

  it('writes every person, the rooms, the org and an office into a studio.yaml that parses', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    const result = ops.write(root, cafe());
    expect(result.message).toBe(
      "Wrote the org of Café Lumen: 18 people in 4 rooms, with a meeting room and the CEO's office. The files it replaced are backed up in .claude/studio/backup/.",
    );
    expect(result.changed).toContain('.claude/agents/twint-payments-engineer.md');
    expect(result.changed).toContain('CLAUDE.md');
    const studio = studioOf(root);
    expect(studio.name).toBe('Café Lumen');
    expect(studio.departments).toEqual([
      { id: 'direction', name: 'Direction', style: 'direction' },
      { id: 'design', name: 'Design', style: 'design', theme: 'cafe' },
      { id: 'engineering', name: 'Engineering', style: 'engineering' },
      { id: 'content', name: 'Content', style: 'content' },
    ]);
    expect(studio.office).toEqual({
      theme: 'cafe',
      rooms: [
        { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
        { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
      ],
      decor: [],
    });
    const raw = cafeProposal();
    expect(studio.roles.map((r) => [r.id, r.name, r.level, r.reportsTo ?? null, r.department, r.archetype ?? null])).toEqual(
      raw.people.map((p) => [p.id, p.name, p.level, p.reportsTo, p.room, p.library ?? null]),
    );
    expect(studio.roles.find((r) => r.id === 'ui-designer')?.look).toEqual({ skin: 3, prop: 'tablet' });
    expect(studio.fired).toEqual([]);
  });

  it('writes each person’s agent file through the composer, with their place, area and notes', () => {
    const root = company();
    expect(readAgents(root).map((a) => a.id).sort()).toEqual(cafeProposal().people.map((p) => String(p.id)).sort());

    const head = agentOf(root, 'head-of-design');
    expect(head.data).toEqual({ name: 'head-of-design', description: library.roles.get('head')?.description, model: 'opus', color: 'pink' });
    expect(head.body).toContain(library.roles.get('head')?.body ?? 'the head role');
    expect(head.body).toContain(
      [
        '<!-- worklings:notes -->',
        '- You are Ada, head of design. You report to Noor, CEO.',
        '- You own the brand, the menu pages and the pickup flow.',
        '- Nothing in design ships without a check at phone size.',
        '<!-- /worklings:notes -->',
      ].join('\n'),
    );
    expect(head.body).toContain(`- **What it is:** ${cafeProposal().goal}`);
    // In a company everything else goes back to the person's manager, and the CEO's to the stakeholder.
    expect(head.body).toContain('\n- Everything else goes back to Noor, CEO, with what you did, how you checked it and what is left.\n');
    expect(agentOf(root, 'frontend-engineer').body).toContain('\n- Everything else goes back to Ola, frontend lead, with what you did');
    expect(agentOf(root, 'ceo').body).toContain('\n- Everything else goes back to the stakeholder with what you did');
    expect(agentOf(root, 'ceo').body).not.toContain('the main session');
    expect(agentOf(root, 'ceo').body).toContain('- You are Noor, CEO. You report to the stakeholder.\n- You own the company, its goal and the line to the stakeholder.\n');
    expect(agentOf(root, 'frontend-engineer').body).toContain('- You are Sam, frontend engineer. You report to Ola, frontend lead.\n');
    expect(agentOf(root, 'devops-engineer').data).toMatchObject({ model: 'haiku', color: 'blue' });
  });

  it('points hand-offs at the people who hold those roles, under their own titles', () => {
    const root = company();
    const handoff = (from: string, to: string) => {
      const when = library.roles.get(from)?.handoffs[to] ?? '';
      return when.replace(/\.$/, '');
    };
    // The localization specialist hands off to the seo-specialist role, which Pia holds as the local SEO specialist.
    expect(agentOf(root, 'localization-specialist').body).toContain(`- To \`local-seo-specialist\` (Local SEO specialist) when ${handoff('localization-specialist', 'seo-specialist')}.`);
    // Both people who hold the frontend-engineer role get the accessibility specialist's hand-off.
    const a11y = agentOf(root, 'accessibility-specialist').body;
    expect(a11y).toContain(`- To \`frontend-lead\` (Frontend lead) when ${handoff('accessibility-specialist', 'frontend-engineer')}.`);
    expect(a11y).toContain(`- To \`frontend-engineer\` (Frontend engineer) when ${handoff('accessibility-specialist', 'frontend-engineer')}.`);
    const ceo = agentOf(root, 'ceo').body;
    for (const head of ['head-of-design', 'head-of-engineering', 'head-of-content']) expect(ceo).toContain(`- To \`${head}\` (Head of `);
    expect(ceo).toContain(`- To \`office-manager\` (Office manager) when ${handoff('ceo', 'office-manager')}.`);
    expect(ceo).not.toContain('`producer`');
  });

  it('writes a role for the company like a library role, and the library linter passes it', () => {
    const root = company();
    const twint = agentOf(root, 'twint-payments-engineer');
    expect(twint.data).toEqual({ name: 'twint-payments-engineer', description: TWINT_ROLE.description, model: 'opus', color: 'blue' });
    expect(
      twint.body.startsWith(
        `${TWINT_ROLE.body}\n\n## Hand off\n- Everything else goes back to Ben, head of engineering, with what you did, how you checked it and what is left.\n\n## This project\n`,
      ),
    ).toBe(true);
    expect(twint.body).toContain('\n## This project\n- **Project:** Café Lumen\n');
    // The same role as a library file, to the library's bar.
    const lib = writeTree(tempDir('worklings-lib-'), {
      'roles/twint-payments-engineer.md': [
        '---',
        'name: twint-payments-engineer',
        'title: TWINT payments engineer',
        'department: engineering',
        `description: ${JSON.stringify(TWINT_ROLE.description)}`,
        'model: opus',
        `tags: [${TWINT_ROLE.tags.join(', ')}]`,
        '---',
        TWINT_ROLE.body,
        '',
      ].join('\n'),
    });
    const linted = loadLibrary(lib);
    expect(linted.roles.get('twint-payments-engineer')?.body).toBe(TWINT_ROLE.body);
    expect(lintLibrary(linted)).toEqual([]);
  });

  it('lists the company in CLAUDE.md’s block', () => {
    const root = company();
    const claude = read(root, 'CLAUDE.md');
    expect(claude).toContain('This project is run by Café Lumen, a Worklings company of 18 people led by a CEO who works for the stakeholder.');
    expect(claude).toContain(
      "| Engineering | `twint-payments-engineer` | Lina, TWINT payments engineer. Builds and fixes TWINT payments for pickup orders: the checkout's payment step, the payment provider's API and webhooks, refunds and the daily reconciliation, in Swiss francs. |",
    );
    expect(claude).toContain('| Content | `local-seo-specialist` | Pia, local SEO specialist. Handles technical and on-page SEO:');
    expect(claude.match(/^\| [^|]+ \| `[a-z0-9-]+` \|/gm)).toHaveLength(18);
  });

  it('changes nothing when the same org is written again', () => {
    const root = company();
    const before = snapshot(root);
    expect(ops.write(root, cafe()).changed).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('fires the roles of an earlier studio that the org leaves out, keeps its rules and gates, and rehire brings one back', () => {
    const root = v1Project();
    const earlier = studioOf(root);
    ops.found(root, CAFE_PROMPT);
    const kept = new Set(cafeProposal().people.map((p) => String(p.id)));
    const left = earlier.roles.map((r) => r.id).filter((id) => !kept.has(id));
    expect(left).toEqual(['code-reviewer', 'security-reviewer']);
    const result = ops.write(root, cafe());
    expect(result.message).toContain('Fired code-reviewer and security-reviewer, whom the proposal leaves out; rehiring brings any of them back.');
    const studio = studioOf(root);
    expect(studio.fired.map((f) => [f.id, f.file])).toEqual(left.map((id) => [id, `.claude/studio/fired/${id}.md`]));
    for (const id of left) expect(existsSync(join(root, `.claude/studio/fired/${id}.md`))).toBe(true);
    expect(studio.rules.map((r) => r.id)).toEqual(earlier.rules.map((r) => r.id));
    expect(studio.gates.map((g) => g.id)).toEqual(earlier.gates.map((g) => g.id));
    // The org's rooms come first; a gate whose room the org has no style for keeps that room.
    expect(studio.departments.slice(0, 4).map((d) => d.id)).toEqual(['direction', 'design', 'engineering', 'content']);
    expect(studio.gates.find((g) => g.id === 'code-gate')).toMatchObject({ from: 'engineering', to: 'quality' });
    expect(studio.departments.find((d) => d.id === 'quality')).toEqual({ id: 'quality', name: 'Quality', style: 'quality' });

    expect(ops.rehire(root, 'code-reviewer').message).toBe('Rehired the code reviewer in Quality, reporting to Noor, CEO. Firing the code reviewer again undoes it.');
    expect(studioOf(root).roles.find((r) => r.id === 'code-reviewer')).toMatchObject({ reportsTo: 'ceo', department: 'quality' });
  });

  it('moves the old file of a role kept under another file name out of the way', () => {
    const root = writeTree(tempDir(), {
      '.claude/agents/engineering/frontend-developer.md': '---\nname: Frontend Developer\ndescription: Builds the UI.\n---\nBody\n',
    });
    ops.found(root, CAFE_PROMPT);
    ops.write(
      root,
      cafe((p) => {
        personOf(p, 'frontend-engineer').id = 'frontend-developer';
      }),
    );
    // One agent under that name, not the new one next to the old "Frontend Developer".
    expect(readAgents(root).map((a) => a.id).filter((id) => /frontend/i.test(id)).sort()).toEqual(['frontend-developer', 'frontend-lead']);
    expect(existsSync(join(root, '.claude/agents/engineering/frontend-developer.md'))).toBe(false);
    const backups = readdirSync(join(root, '.claude/studio/backup'));
    expect(backups.some((stamp) => existsSync(join(root, '.claude/studio/backup', stamp, '.claude/agents/engineering/frontend-developer.md')))).toBe(true);
  });

  it('keeps the office’s extra rooms, decor and looks when the org is written again', () => {
    const root = company();
    ops.changeOffice(root, { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' } });
    ops.changeOffice(root, { change: 'decor', add: ['plants'], remove: [] });
    ops.changeOffice(root, { change: 'look', person: 'copywriter', look: { color: '#aa3355' } });
    ops.write(root, cafe((p) => (p.theme = 'garden')));
    const studio = studioOf(root);
    expect(studio.office).toEqual({
      theme: 'garden',
      rooms: [
        { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
        { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
        { id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' },
      ],
      decor: ['plants'],
    });
    expect(studio.roles.find((r) => r.id === 'copywriter')?.look).toEqual({ color: '#aa3355' });
  });

  it('starts an org of two, and one the stakeholder cut to the CEO alone', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    // The CEO and one maker who reports to it: a single small deliverable, no heads.
    const two = cafeProposal();
    two.people = two.people.filter((p) => ['ceo', 'backend-engineer'].includes(String(p.id))).map((p) => (p.id === 'ceo' ? p : { ...p, reportsTo: 'ceo' }));
    two.rooms = two.rooms.filter((r) => ['direction', 'engineering'].includes(r.id));
    two.size = 'small';
    expect(ops.check(two, { preset: 'thorough' }).ok).toBe(true);
    expect(ops.write(root, two as unknown as OrgProposal).ok).toBe(true);
    expect(studioOf(root).roles.map((r) => [r.id, r.level ?? 'worker', r.reportsTo ?? null])).toEqual([['ceo', 'ceo', null], ['backend-engineer', 'worker', 'ceo']]);
    // The CEO's check refuses the CEO alone; the stakeholder's own edit still starts.
    const alone = cafeProposal();
    alone.people = alone.people.filter((p) => p.id === 'ceo');
    alone.rooms = alone.rooms.filter((r) => r.id === 'direction');
    expect(ops.check(alone, { preset: 'thorough' }).ok).toBe(false);
    const other = tempDir();
    ops.found(other, CAFE_PROMPT);
    expect(ops.write(other, alone as unknown as OrgProposal).ok).toBe(true);
    expect(studioOf(other).roles.map((r) => r.id)).toEqual(['ceo']);
  });

  it('refuses a proposal that does not check out, and changes nothing', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    const before = snapshot(root);
    const bad = cafeProposal();
    personOf(bad, 'ux-designer').id = '../../outside';
    const error = refusal(() => ops.write(root, bad as unknown as OrgProposal));
    expect(error.code).toBe('invalid');
    expect(error.message).toBe(
      'The proposal has a problem, so nothing was written: people[4].id: expected lowercase letters, digits and hyphens, got "../../outside".',
    );
    expect(snapshot(root)).toEqual(before);
  });

  it('changes nothing while studio.yaml has a mistake', () => {
    const root = company();
    const manifest = join(root, '.claude/studio.yaml');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('level: head', 'level: boss'));
    const before = snapshot(root);
    expect(refusal(() => ops.write(root, cafe())).message).toMatch(/^\.claude\/studio\.yaml has a problem, so nothing was changed: roles\[3\]\.level/);
    expect(snapshot(root)).toEqual(before);
  });

  it('writes only inside .claude and CLAUDE.md, and never through a link', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    ops.write(root, cafe());
    expect(Object.keys(snapshot(root)).filter((path) => !path.startsWith('.claude/') && path !== 'CLAUDE.md')).toEqual([]);

    const linked = tempDir();
    ops.found(linked, CAFE_PROMPT);
    const outside = tempDir();
    rmSync(join(linked, '.claude/agents'), { recursive: true });
    symlinkSync(outside, join(linked, '.claude/agents'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = snapshot(linked);
    expect(refusal(() => ops.write(linked, cafe())).message).toBe(".claude/agents is a symlink or junction; Worklings doesn't read or write through links.");
    expect(readdirSync(outside)).toEqual([]);
    expect(snapshot(linked)).toEqual(before);
  });
});
