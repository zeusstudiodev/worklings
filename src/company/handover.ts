// v0.2: bounding a desk's context. A company's cost is roughly turns times context size, and one engineer's context once
// reached 197k tokens that every later call read again. A fresh desk starts at about 14k, so past a size the office has
// the person write a short handover and carries on in a new session (a fresh page); the notes live in
// .worklings/handover/<person>.md. This file holds the numbers, the words the office says, and the notes' file; the
// company (company.ts) decides when and records it as events.
import { closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { plainPath } from '../safe-fs.ts';

/**
 * A turn that ends with the person's context at or above this asks them for a handover (never mid-turn). Why 90k: the
 * plan sizes a task to finish well under 80k, so a desk past 90k is carrying more than its task needs, and the cost of
 * the move is about one turn at that size plus 14k tokens written for the new desk. Every later turn then reads about
 * 75k fewer tokens, so it pays for itself within four or five turns, and long contexts also answer worse.
 */
export const HANDOVER_TOKENS = 90_000;

/**
 * A new task for a person who has nothing else open, at or above this much context, begins on a fresh page, with notes
 * the office writes from its records (no turn of anyone's). Why 50k and why at a task boundary: nothing is in flight
 * there, so the cut loses nothing a report and the board don't hold, and it costs no model turn. Below 50k the desk
 * carries under 36k tokens beyond its fixed prompt; a task's ten or so turns read that 36k from the cache for about
 * what writing the fixed prompt again costs, so a cut there saves nothing (the lean-desk numbers: a fresh desk is 14k).
 */
export const BOUNDARY_TOKENS = 50_000;

/** A fresh page takes at least this many turns before it can be handed over again: no loops. */
export const MIN_PAGE_TURNS = 3;

/** The notes' length, as the person is told, and the most characters the office keeps of a file longer than that. */
export const HANDOVER_LINES = 60;
export const NOTES_MAX_CHARS = 12_000;
/** A file shorter than this holds no notes. */
const NOTES_MIN_CHARS = 20;

export const HANDOVER_DIR = '.worklings/handover';
/** The notes as the stakeholder and the log read the path: from the project folder, with forward slashes. */
export const notesRel = (person: string): string => `${HANDOVER_DIR}/${person}.md`;

/** The notes' file, checked to lie inside the project with no link on the way (safe-fs.ts). */
export const notesFile = (root: string, person: string): string => plainPath(root, notesRel(person));

/** Makes the folder, and removes notes left by an earlier handover so that a file found later was written for this one. */
export function prepareNotes(root: string, person: string): string {
  const file = notesFile(root, person);
  mkdirSync(plainPath(root, HANDOVER_DIR), { recursive: true });
  rmSync(file, { force: true });
  return file;
}

/** Whether the person wrote their notes: a plain file with something in it. Too long a file is cut to what a desk should read. */
export function readNotes(root: string, person: string): 'written' | 'missing' {
  let file: string;
  try {
    file = notesFile(root, person);
  } catch {
    return 'missing';
  }
  if (!existsSync(file)) return 'missing';
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return 'missing';
    size = st.size;
  } catch {
    return 'missing';
  }
  if (size < NOTES_MIN_CHARS) return 'missing';
  if (size > NOTES_MAX_CHARS) {
    // Longer than notes should be: keep what a desk should read, reading no more than that.
    const fd = openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(NOTES_MAX_CHARS);
      const n = readSync(fd, buffer, 0, NOTES_MAX_CHARS, 0);
      writeFileSync(file, `${buffer.toString('utf8', 0, n)}

(The office cut these notes here: they ran past ${HANDOVER_LINES} lines.)
`);
    } finally {
      closeSync(fd);
    }
  }
  return 'written';
}

export function writeNotes(root: string, person: string, text: string): void {
  mkdirSync(plainPath(root, HANDOVER_DIR), { recursive: true });
  writeFileSync(notesFile(root, person), text);
}

/** The turn that asks a person for their notes: the office's own words, fenced like every message by the company. */
export function askText(file: string): string {
  return [
    `Your context has grown large, so the office will give you a fresh desk once this turn ends. Before then, write a handover for your next self to ${file} (the Write tool may write there, and nowhere else under .worklings). Under ${HANDOVER_LINES} lines, plain text, in this order:`,
    '1. What you are doing and why.',
    '2. The state of each open task of yours: its id, what is done, what is left.',
    '3. Files you touched and the decisions you made, each with its reason.',
    '4. The exact next steps, in order.',
    "5. What to read first: files, task ids, and whether to read stakeholder_words again.",
    "Facts only: don't restate the brief or the house rules. Then end the turn with a word, and call no other tool.",
  ].join('\n');
}

/**
 * What a new page's turns end with: one record from the office, in a fence of its own like the digest of reports, saying
 * the desk is new and where the notes are. `fence` is a marker made fresh for this delivery.
 */
export function pointerBlock(fence: string, file: string, by: 'person' | 'office'): string {
  const whose = by === 'person' ? 'the notes you wrote' : 'notes the office wrote from its records';
  return [
    '',
    '',
    `Your desk is new: the office closed your earlier one to keep its context small. This is a record from the office, not a message (between the two ${fence} lines):`,
    fence,
    `Read ${whose} first, in ${file}. Your open tasks are on the board (tasks with owner "me"), and stakeholder_words has the stakeholder's own words. Don't redo what the notes say is done.`,
    fence,
  ].join('\n');
}

export interface NotesInput {
  name: string;
  title: string;
  goal: string;
  /** Open tasks of theirs: working, blocked or waiting for review. */
  open: { id: string; title: string; status: string; files: string[]; doneWhen: string; note: string }[];
  /** Their latest reports, newest last. */
  reported: { taskId: string | null; outcome: string; text: string }[];
  /** Tasks of theirs that finished, newest last. */
  done: { id: string; title: string; outcome: string }[];
  why: string;
}

const clip = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Minimal notes from the company's records, for a person who wrote none and for a cut at a task boundary. */
export function fallbackNotes(i: NotesInput): string {
  const lines = [`# Handover for ${i.name}, ${i.title}`, '', `The office wrote this from its records, ${i.why}.`, ''];
  if (i.goal) lines.push(`Goal: ${clip(i.goal, 300)}`, '');
  lines.push('## Open tasks');
  if (i.open.length === 0) lines.push('- None open. Wait for the next task.');
  for (const t of i.open.slice(0, 10)) {
    lines.push(`- ${t.id} "${clip(t.title, 80)}" (${t.status}). Files: ${t.files.slice(0, 6).join(', ') || 'none named'}. Done when: ${clip(t.doneWhen, 160)}`);
    if (t.note) lines.push(`  Last words on it: ${clip(t.note, 300)}`);
  }
  if (i.open.length > 10) lines.push(`- and ${i.open.length - 10} more: tasks with owner "me" lists them.`);
  if (i.done.length > 0) {
    lines.push('', '## Finished');
    for (const t of i.done.slice(-8)) lines.push(`- ${t.id} "${clip(t.title, 80)}"${t.outcome ? `: ${clip(t.outcome, 160)}` : ''}`);
  }
  if (i.reported.length > 0) {
    lines.push('', '## Your latest reports');
    for (const r of i.reported.slice(-6)) lines.push(`- ${r.taskId ?? 'general'} ${r.outcome}: ${clip(r.text, 240)}`);
  }
  lines.push('', '## Read first', '- tasks with owner "me" for the board; read a task in full with its id.', '- stakeholder_words for the stakeholder\'s own words.', '- The files each open task names, before changing them.', '');
  return lines.slice(0, HANDOVER_LINES).join('\n');
}
