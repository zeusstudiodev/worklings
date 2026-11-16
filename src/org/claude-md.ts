// The studio block in CLAUDE.md for a company: the composer's markers, heading and table, with the company's people
// in place of a domain's roles. Every desk loads CLAUDE.md, so the block says how a session the office started differs
// from one the person started themselves.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CLAUDE_START, LEGACY_CLAUDE_START, withClaudeBlock } from '../composer/compose.ts';
import { peopleOf } from '../core/company.ts';
import { inSentence, type Studio } from '../core/studio.ts';
import { plainPath } from '../safe-fs.ts';
import { readAgents } from '../server/project.ts';

const firstSentence = (text: string) => (/^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text).trim();

/** `text` as a code span, fenced with more backticks than it holds. */
function codeSpan(text: string): string {
  const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Text from outside the library, on one line and unable to close the block it sits in (its markers are HTML comments).
 * Claude Code reads "@path" in CLAUDE.md as a file to import into every session, but not inside a code span, so every
 * word with an "@" in it is set in one: the checks refuse such words at input, and this holds for whatever got past
 * them (an agent file edited by hand).
 */
const plain = (text: string) => text.replace(/\s+/g, ' ').replaceAll('<!--', '&lt;!--').trim().replace(/\S*@\S*/g, codeSpan);
/** Text in a table cell: plain, with its pipes escaped. */
const cell = (text: string) => plain(text).replaceAll('|', '\\|');

/** The block between the markers. `describe` gives a role's description (its agent file's, or the one about to be written). */
export function companyBlock(studio: Studio, describe: (roleId: string) => string): string {
  const people = peopleOf(studio);
  const roomName = (id: string) => studio.departments.find((d) => d.id === id)?.name ?? id;
  const rows = people.map((p) => {
    const who = p.name === p.title ? '' : `${p.name}, ${inSentence(p.title)}. `;
    const use = firstSentence(describe(p.id)) || p.title;
    return `| ${cell(roomName(p.room))} | \`${p.id}\` | ${cell(who + use)} |`;
  });
  const founding = people.length === 1 && people[0]?.level === 'ceo';
  const who = founding
    ? `${plain(studio.name)}, a Worklings company being founded: its CEO is drafting the org for the stakeholder.`
    : `${plain(studio.name)}, a Worklings company of ${people.length === 1 ? 'one person' : `${people.length} people`} led by a CEO who works for the stakeholder.`;
  const skills = studio.skills.map((s) => `\`/${s.id}\``);
  const gates = studio.gates.map((g) => `\`/${g.id}\``);
  const gateLine =
    gates.length === 0
      ? ''
      : studio.rigor === 'lean'
        ? `Gates (run when the change is risky or about to ship): ${gates.join(', ')}.`
        : `Gates (required before a change ships, in this order): ${gates.join(', ')}.`;
  return [
    '## Studio',
    '',
    `This project is run by ${who}`,
    'The manifest is `.claude/studio.yaml`; `worklings hub` opens the office where the company works and shows what',
    'each person costs.',
    '',
    'In a session the office started, your appended instructions say who you are, whom you report to and how messages',
    'reach you. In a session the person started themselves, you are the lead: you talk to them, plan, do small work',
    'yourself, and delegate to these roles when the work is substantial, needs an independent view or can run in',
    'parallel, with a brief that gives the goal, the files and what done means.',
    '',
    '| Room | Role | Use it for |',
    '|---|---|---|',
    ...rows,
    '',
    skills.length > 0 ? `Workflows: ${skills.join(', ')}.` : '',
    gateLine,
    'Rules for specific paths are in `.claude/rules/` and load when matching files are read.',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n')
    .trim();
}

/** Descriptions from the agent files on disk, by role. */
export function describedOnDisk(root: string, studio: Studio): (roleId: string) => string {
  const byName = new Map(readAgents(root).map((a) => [a.id, a.description]));
  return (roleId) => {
    const role = studio.roles.find((r) => r.id === roleId);
    return (role && byName.get(role.agent ?? role.id)) ?? '';
  };
}

/**
 * Puts the company's block in place of the one CLAUDE.md has, after a hire, fire, move or rehire. A CLAUDE.md without
 * a block was left that way on purpose, so it isn't given one. Returns "CLAUDE.md" when it changed.
 */
export function refreshBlock(root: string, studio: Studio): string | null {
  const path = plainPath(root, 'CLAUDE.md');
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  if (!text.includes(CLAUDE_START) && !text.includes(LEGACY_CLAUDE_START)) return null;
  const next = withClaudeBlock(text, companyBlock(studio, describedOnDisk(root, studio)));
  if (next === text) return null;
  writeFileSync(path, next);
  return 'CLAUDE.md';
}
