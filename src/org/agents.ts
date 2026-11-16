// A company's people as agent files: a library role, or one written for the company, through the composer's own
// agentFile, with hand-offs pointed at the people who hold those roles, and notes (through tailorRole) that say who
// each person is, whom they report to and what they own.
import { readFileSync, writeFileSync } from 'node:fs';
import { type AgentContext, agentFile } from '../composer/compose.ts';
import { type Library, type LibraryRole, lintLibrary } from '../composer/library.ts';
import { LEGACY_NOTES_END, LEGACY_NOTES_START, NOTES_END, NOTES_START, TailorError, tailorRole } from '../composer/tailor.ts';
import { introduce, type Person, peopleOf } from '../core/company.ts';
import type { BaseDepartment } from '../core/departments.ts';
import type { NewRole, RoleDraft } from '../core/org.ts';
import type { RoleModel, Studio } from '../core/studio.ts';
import { ORG_SERVER } from '../runtime/harness.ts';
import { plainPath } from '../safe-fs.ts';
import { agentFileOf } from '../server/project.ts';

/**
 * The org tools as an agent file's `tools:` names them: the whole server. A desk runs as its person's agent file
 * (--agent), and a `tools:` line there hides every tool it doesn't name, the --mcp-config ones included, so a reviewer
 * limited to Read, Grep, Glob and Bash couldn't report, message or post a status. Claude Code 2.1.312 keeps a server's
 * tools for `mcp__org`, `mcp__org__*` or each name (docs/claude-code-surfaces.md, "Org tools over MCP"); the server
 * covers every tool a later promotion adds.
 */
export const ORG_TOOLS_ENTRY = `mcp__${ORG_SERVER}`;

/** A role's tool allowlist with the org tools kept; null (every tool) stays null. */
export function withOrgTools(tools: readonly string[] | null): string[] | null {
  if (tools === null) return null;
  const kept = tools.some((t) => t === ORG_TOOLS_ENTRY || t === `${ORG_TOOLS_ENTRY}__*`);
  return kept ? [...tools] : [...tools, ORG_TOOLS_ENTRY];
}

/** Someone on staff as hand-offs find them: by the library role they hold, or by their id. */
export interface StaffMember {
  id: string;
  title: string;
  archetype?: string;
}

export const staffOf = (studio: Studio): StaffMember[] =>
  studio.roles.map((r) => (r.archetype ? { id: r.id, title: r.title, archetype: r.archetype } : { id: r.id, title: r.title }));

/** Where a person sits, as their agent file shows it: their id, title, the style of their room and their model. */
export interface Seat {
  id: string;
  title: string;
  style: BaseDepartment;
  model: RoleModel;
}

/** A library role as one person holds it: their id and title, their room's colour, the model the CEO picked. */
export const roleFromLibrary = (role: LibraryRole, seat: Seat): LibraryRole => ({ ...role, id: seat.id, title: seat.title, department: seat.style, model: seat.model });

/** A role written for the company, in the library's shape, so the composer writes it like any other. */
export const roleFromProposal = (role: NewRole, seat: Seat): LibraryRole => ({
  id: seat.id,
  title: seat.title,
  department: seat.style,
  description: role.description,
  model: seat.model,
  tools: null,
  tags: role.tags ?? [],
  handoffs: {},
  body: role.body,
});

const BLANK: LibraryRole = { id: '', title: '', department: 'direction', description: '', model: 'inherit', tools: null, tags: [], handoffs: {}, body: '' };

/** The composer's last hand-off line ("Everything else goes back to the lead (the main session) with ..."). */
const CLOSING = /^- Everything else goes back to .*$/m;
const closingLine = (back: string) => `- Everything else goes back to ${back} with what you did, how you checked it and what is left.`;

/**
 * Whom a person's work goes back to in a company, as the closing hand-off says it: their manager ("Ada, head of
 * design,"), or the stakeholder for the CEO. Null for someone with neither, who keeps the composer's line.
 */
export function backTo(people: readonly Person[], person: Person): string | null {
  if (person.level === 'ceo') return 'the stakeholder';
  const manager = person.reportsTo ? people.find((p) => p.id === person.reportsTo) : undefined;
  if (!manager) return null;
  return manager.name === manager.title ? introduce(manager) : `${introduce(manager)},`;
}

/** An agent file with its closing hand-off sent `back` to someone, in the composer's Hand off section only. */
function withClosing(text: string, back: string): string {
  const at = text.lastIndexOf('\n## Hand off\n');
  return at === -1 ? text : text.slice(0, at) + text.slice(at).replace(CLOSING, closingLine(back));
}

/**
 * A person's agent file, written by the composer's agentFile. Library hand-offs name library roles ("hand off to the
 * qa-engineer"); in a company they go to whoever holds that role, under the person's own id and title, and everything
 * else goes `back` to their manager (see backTo) instead of to the main session. A role that limits its tools keeps the
 * org tools (withOrgTools).
 */
export function orgAgentFile(role: LibraryRole, staff: readonly StaffMember[], library: Library, ctx: AgentContext, back: string | null): string {
  const handoffs = Object.create(null) as Record<string, string>;
  for (const [target, when] of Object.entries(role.handoffs)) {
    for (const s of staff) if (s.id !== role.id && (s.archetype ?? s.id) === target && !Object.hasOwn(handoffs, s.id)) handoffs[s.id] = when;
  }
  // agentFile titles a hand-off from the library; these are the people's own titles.
  const view: Library = { ...library, roles: new Map(staff.map((s) => [s.id, { ...BLANK, id: s.id, title: s.title }])) };
  const text = agentFile({ ...role, tools: withOrgTools(role.tools), handoffs }, new Set(staff.map((s) => s.id)), view, ctx);
  return back ? withClosing(text, back) : text;
}

/** The library linter's own checks on a role written for the company, as sentences without the file name. */
export function lintNewRole(library: Library, draft: RoleDraft): string[] {
  const role = roleFromProposal(draft, { id: draft.id, title: draft.title, style: draft.department, model: draft.model });
  const prefix = `roles/${draft.id}.md: `;
  return lintLibrary({ root: library.root, roles: new Map([[draft.id, role]]), rules: new Map(), skills: new Map(), domains: new Map(), problems: [] }).map((p) =>
    p.startsWith(prefix) ? p.slice(prefix.length) : p,
  );
}

/** "You are Ada, head of design. You report to Noor, CEO." The first note in every person's agent file. */
export function placeNote(people: readonly Person[], person: Person): string {
  const manager = person.reportsTo ? people.find((p) => p.id === person.reportsTo) : undefined;
  const reports = person.level === 'ceo' ? ' You report to the stakeholder.' : manager ? ` You report to ${introduce(manager)}.` : '';
  return `You are ${introduce(person)}.${reports}`;
}

/**
 * "You own the menu pages and the pickup flow.", however the CEO phrased what the person owns. A capital that only
 * starts the phrase goes ("Testing orders", "The brand"); names and acronyms keep theirs ("TWINT payments", "Google
 * Business Profile and maps").
 */
export function ownsNote(owns: string): string {
  const area = owns.trim().replace(/^(you\s+)?owns?\s+/i, '').replace(/[\s.!?]+$/, '');
  const [first = '', second = ''] = area.split(/\s+/);
  const opening = /^(The|A|An|All|Any|Every|Each|Its|Their|Our|Your)$/.test(first) || (/^[A-Z][a-z'’-]*[,:;]?$/.test(first) && !/^[A-Z]/.test(second));
  return `You own ${opening ? area.charAt(0).toLowerCase() + area.slice(1) : area}.`;
}

/** As tailorRole writes a note, so notes can be compared with what a file holds. */
const asWritten = (note: string) => note.replace(/\s+/g, ' ').trim().replace(/^[-*]\s+/, '');

/** The notes in an agent file's notes block (or in the block an earlier version wrote). */
export function notesOf(text: string): string[] {
  for (const [open, close] of [
    [NOTES_START, NOTES_END],
    [LEGACY_NOTES_START, LEGACY_NOTES_END],
  ] as const) {
    const start = text.indexOf(open);
    const end = start === -1 ? -1 : text.indexOf(close, start + open.length);
    if (end === -1) continue;
    return text
      .slice(start + open.length, end)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }
  return [];
}

/** Whether an agent file is `fresh` with a notes block after it, as tailorRole adds one: then only its notes differ. */
export function onlyNotesDiffer(existing: string, fresh: string): boolean {
  const text = existing.replace(/\r\n/g, '\n');
  if (!text.startsWith(fresh)) return false;
  const rest = text.slice(fresh.length);
  return rest.startsWith(`${NOTES_START}\n`) && rest.endsWith(`${NOTES_END}\n`) && rest.indexOf(NOTES_END) === rest.length - NOTES_END.length - 1;
}

const PLACE = 'You are ';

/**
 * Keeps a person's agent file in step with their place: the closing hand-off names their manager, and the notes
 * (through tailorRole) start with their place, then `rest`. Without `rest` the notes after the place stay as they are,
 * so a move or a new manager changes those two lines. Returns the file when it changed. Needs the studio on disk to be
 * `studio` (tailorRole reads it); throws TailorError when the file can't take notes.
 */
export function tailorPerson(root: string, studio: Studio, roleId: string, rest?: readonly string[]): string | null {
  const people = peopleOf(studio);
  const person = people.find((p) => p.id === roleId);
  const role = studio.roles.find((r) => r.id === roleId);
  const file = role ? agentFileOf(root, role) : undefined;
  if (!person || !file) return null;
  const path = plainPath(root, file, TailorError);
  const text = readFileSync(path, 'utf8');
  const back = backTo(people, person);
  const closed = back ? withClosing(text, back) : text;
  if (closed !== text) writeFileSync(path, closed);
  const current = notesOf(closed);
  const place = placeNote(people, person);
  const after = rest ?? (current[0]?.startsWith(PLACE) ? current.slice(1) : current);
  const notes = [place, ...after].map(asWritten).filter(Boolean);
  if (notes.length === current.length && notes.every((n, i) => n === current[i])) return closed === text ? null : file;
  return tailorRole(root, roleId, notes);
}
