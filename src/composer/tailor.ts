// Project notes for a role: the few lines that fit a library role to this project. They live between markers at the
// end of the role's "## This project" section, so re-running replaces them and nothing else in the file changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { ROLE_ID } from '../core/studio.ts';
import { plainPath } from '../safe-fs.ts';
import { agentFileOf, loadProjectStudio, readAgents } from '../server/project.ts';
import { replaceMarkedBlock } from './compose.ts';

export const NOTES_START = '<!-- worklings:notes -->';
export const NOTES_END = '<!-- /worklings:notes -->';
/** The markers of notes written while Worklings was called Headcount; tailoring replaces that block with a new one. */
export const LEGACY_NOTES_START = '<!-- headcount:notes -->';
export const LEGACY_NOTES_END = '<!-- /headcount:notes -->';
const MAX_NOTES = 8;
const MAX_NOTE = 300;

export class TailorError extends Error {}

/** Writes the notes into the role's agent file and returns that file's path relative to the project. */
export function tailorRole(root: string, roleId: string, notes: string[]): string {
  if (!ROLE_ID.test(roleId)) throw new TailorError(`"${roleId}" is not a role id like "qa-engineer".`);
  const role = loadProjectStudio(root).studio?.roles.find((r) => r.id === roleId);
  const file = role ? agentFileOf(root, role) : readAgents(root).find((a) => a.id === roleId)?.file;
  if (!file) throw new TailorError(`No agent file for "${roleId}" in .claude/agents: hire the role first.`);
  const path = plainPath(root, file, TailorError);
  const clean = notes.map((n) => n.replace(/\s+/g, ' ').trim().replace(/^[-*]\s+/, '')).filter(Boolean);
  if (clean.length === 0) throw new TailorError('Give at least one note with --note.');
  if (clean.length > MAX_NOTES) throw new TailorError(`Keep it to ${MAX_NOTES} notes or fewer: they are read on every delegation.`);
  const long = clean.find((n) => n.length > MAX_NOTE);
  if (long) throw new TailorError(`Keep each note under ${MAX_NOTE} characters: "${long.slice(0, 40)}…"`);

  const text = readFileSync(path, 'utf8');
  const block = `${NOTES_START}\n${clean.map((n) => `- ${n}`).join('\n')}\n${NOTES_END}`;
  let next = replaceMarkedBlock(text, block, [NOTES_START, NOTES_END], [LEGACY_NOTES_START, LEGACY_NOTES_END]);
  if (next === null) {
    const section = text.indexOf('\n## This project');
    if (section === -1) throw new TailorError(`${file} has no "## This project" section to add notes to.`);
    // The notes go at the end of that section: before the next heading, or at the end of the file.
    const after = text.indexOf('\n## ', section + 1);
    const at = after === -1 ? text.length : after;
    next = `${text.slice(0, at).trimEnd()}\n${block}\n${text.slice(at)}`;
  }
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`);
  return file;
}
