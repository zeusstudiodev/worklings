// What the office turned down from the CEO (v0.2): each refused propose_org or propose_plan, with every sentence it
// came back with, appended to <project>/.worklings/refusals.jsonl. The company's own state keeps only a count and the first
// reason of an org draft; this file is for people and harnesses that want to know how many rounds the shape rules cost
// and why (scripts/plan-only.mjs reads it). Best effort: a failed write never fails the refusal.
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { plainPath } from '../safe-fs.ts';

export const REFUSALS_FILE = '.worklings/refusals.jsonl';

/** What the file holds at the most, so a CEO that is refused for ever can't fill the disk. */
const MAX_BYTES = 256 * 1024;
const MAX_SENTENCES = 30;
const MAX_SENTENCE = 600;

export interface Refusal {
  at: number;
  /** What was refused: the org proposal, or the plan. */
  kind: 'org' | 'plan';
  errors: string[];
}

/** What the office changed in an accepted org proposal or plan instead of refusing it (text cut, a final review added, a wait made). */
export interface Note {
  at: number;
  kind: 'org' | 'plan';
  notes: string[];
}

/** A note, as a line of its own marked `note`, so a reader counting refusals skips it. */
export function recordNote(root: string, note: Note): void {
  if (note.notes.length === 0) return;
  appendLine(root, { at: note.at, kind: note.kind, note: true, count: note.notes.length, notes: note.notes.slice(0, MAX_SENTENCES).map(clip) });
}

const clip = (e: string): string => (e.length > MAX_SENTENCE ? `${e.slice(0, MAX_SENTENCE - 1)}…` : e);

function appendLine(root: string, line: Record<string, unknown>): void {
  try {
    const file = plainPath(root, REFUSALS_FILE);
    mkdirSync(dirname(file), { recursive: true });
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (size > MAX_BYTES) return;
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  } catch {
    // The record is a convenience.
  }
}

export function recordRefusal(root: string, refusal: Refusal): void {
  appendLine(root, { at: refusal.at, kind: refusal.kind, count: refusal.errors.length, errors: refusal.errors.slice(0, MAX_SENTENCES).map(clip) });
}
