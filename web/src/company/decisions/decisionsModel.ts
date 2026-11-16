// The decision log (SPEC-v3.md "Steering" 5): every decision with who, when, what, why and the alternatives, what it
// links to, whether Undo and Reconsider apply, filters by person, room and kind, day headings and pages. Pure, so it can
// be tested; Decisions only draws it.
import { type CompanyView, STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { type Decision, DECISION_KINDS, type DecisionKind } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { atWords, dayLabel, daysAgo, personLabel } from '../dashboards/boardsModel.ts';
import { inboxItemPath } from '../inbox/inboxModel.ts';
import { flatten, nameOf, orgOutline, roomName } from '../people/peopleModel.ts';
import { decisionPath, planPath, tracePath } from '../trace/traceModel.ts';

type Studio = Pick<Snapshot, 'studio'>;
type DecisionCompany = Pick<CompanyView, 'people' | 'messages' | 'tasks'>;

/** A decision's kind as its tag ("Plan") and as the kind filter lists it ("The plan"). */
export const KIND_WORDS: Record<DecisionKind, { tag: string; filter: string }> = {
  answer: { tag: 'Answer', filter: 'Answers' },
  approval: { tag: 'Approval', filter: 'Approvals' },
  rule: { tag: 'Always allow', filter: 'Always allow rules' },
  plan: { tag: 'Plan', filter: 'The plan' },
  org: { tag: 'Org', filter: 'The org' },
  office: { tag: 'Office', filter: 'The office' },
  setting: { tag: 'Setting', filter: 'Settings' },
  leash: { tag: 'Leash', filter: 'Leashes' },
  task: { tag: 'Task', filter: 'Tasks' },
  decide: { tag: 'Their call', filter: 'Calls people made' },
  undo: { tag: 'Undo', filter: 'Undos' },
  reconsider: { tag: 'Reconsider', filter: 'Reconsiders' },
};

const isKind = (v: string): v is DecisionKind => (DECISION_KINDS as readonly string[]).includes(v);

/** How many entries a page shows; "Show more" adds this many again. */
export const DECISION_PAGE = 50;

// ---------------------------------------------------------------------------------------------------------------
// Filters

/** Empty strings mean any. */
export interface DecisionFilter {
  who: string;
  room: string;
  kind: string;
}

export const NO_FILTER: DecisionFilter = { who: '', room: '', kind: '' };
export const isFiltered = (f: DecisionFilter): boolean => f.who !== '' || f.room !== '' || f.kind !== '';

const newestFirst = (a: Decision, b: Decision) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The decisions a filter keeps, newest first. Person: anyone it concerns (the decider among them). */
export function filterDecisions(decisions: readonly Decision[], f: DecisionFilter): Decision[] {
  return decisions
    .filter((d) => (f.who === '' || d.by === f.who || d.people.includes(f.who)) && (f.room === '' || d.rooms.includes(f.room)) && (f.kind === '' || d.kind === f.kind))
    .sort(newestFirst);
}

export interface Choice {
  value: string;
  label: string;
}

/** What each filter offers: only who, rooms and kinds the log holds, with how many decisions each has. */
export function filterChoices(snapshot: Studio, company: Pick<CompanyView, 'people'>, decisions: readonly Decision[]): { who: Choice[]; rooms: Choice[]; kinds: Choice[] } {
  const count = (pick: (d: Decision) => readonly string[]) => {
    const counts = new Map<string, number>();
    for (const d of decisions) for (const v of new Set(pick(d))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };
  const people = count((d) => [d.by, ...d.people]);
  const rooms = count((d) => d.rooms);
  const kinds = count((d) => [d.kind]);
  const withCount = (label: string, n: number) => `${label} (${n})`;

  const ordered = flatten(orgOutline(snapshot, company)).map((n) => n.person);
  const who: Choice[] = [];
  if (people.has(STAKEHOLDER)) who.push({ value: STAKEHOLDER, label: withCount('You', people.get(STAKEHOLDER) ?? 0) });
  for (const p of ordered) if (people.has(p.id)) who.push({ value: p.id, label: withCount(personLabel(p), people.get(p.id) ?? 0) });
  for (const [id, n] of people) {
    if (id === STAKEHOLDER || id === THE_OFFICE || ordered.some((p) => p.id === id)) continue;
    who.push({ value: id, label: withCount(capital(nameOf(company, id).called), n) });
  }
  if (people.has(THE_OFFICE)) who.push({ value: THE_OFFICE, label: withCount('The office', people.get(THE_OFFICE) ?? 0) });

  return {
    who,
    rooms: [...rooms].map(([id, n]) => ({ value: id, label: withCount(roomName(snapshot, id), n) })).sort((a, b) => a.label.localeCompare(b.label)),
    kinds: DECISION_KINDS.filter((k) => kinds.has(k)).map((k) => ({ value: k, label: withCount(KIND_WORDS[k].filter, kinds.get(k) ?? 0) })),
  };
}

/** A filter with only values the log still holds, so a choice that left doesn't hide everything. */
export function validFilter(f: DecisionFilter, choices: ReturnType<typeof filterChoices>): DecisionFilter {
  const keeps = (value: string, list: readonly Choice[]) => (value === '' || list.some((c) => c.value === value) ? value : '');
  return { who: keeps(f.who, choices.who), room: keeps(f.room, choices.rooms), kind: isKind(f.kind) ? keeps(f.kind, choices.kinds) : '' };
}

/** "300 decisions, newest first." or "12 of 300 decisions match." */
export function countLine(shown: number, total: number, filtered: boolean): string {
  const word = (n: number) => (n <= 12 ? countWord(n) : String(n));
  if (total === 0) return '';
  if (!filtered) return `${capital(word(total))} ${total === 1 ? 'decision' : 'decisions'}, newest first.`;
  return `${capital(word(shown))} of ${word(total)} ${total === 1 ? 'decision matches' : 'decisions match'}.`;
}

export const NO_DECISIONS = 'No decisions yet. Your answers, approvals and settings, changes to the plan, the org and the office, and the calls people make land here as they happen.';
export const NONE_MATCH = 'No decisions match these filters.';

// ---------------------------------------------------------------------------------------------------------------
// Entries

export interface DecisionLink {
  key: string;
  label: string;
  path: string;
}

export interface DecisionEntry {
  id: string;
  what: string;
  /** "By Ada, head of design, at 14:32." */
  by: string;
  tag: string;
  why: string | null;
  alternatives: string[];
  links: DecisionLink[];
  /** "Undone by you at 14:40.", with the undo's place in the log. */
  undone: { text: string; path: string } | null;
  /** "You asked Ada to reconsider at 14:41: “Charcoal reads better at night.”" */
  reconsidered: { text: string; path: string } | null;
  canUndo: boolean;
  /** Who Reconsider goes to; null when nobody in the company made it (you, the office, someone who left). */
  reconsiderTo: { id: string; name: string } | null;
}

const said = (text: string, max: number): string => clip(plainText(text), max);
const endSentence = (text: string): string => (/[.?!…]$/.test(text) ? text : `${text}.`);

function messageLink(company: DecisionCompany, id: string): DecisionLink {
  const m = company.messages.find((x) => x.id === id);
  const called = (who: string) => nameOf(company, who).called;
  if (!m) return { key: `message:${id}`, label: 'The message', path: tracePath(id) };
  if (m.from === STAKEHOLDER) return { key: `message:${id}`, label: `Your message to ${m.audience ? m.audience.title : called(m.to)}`, path: tracePath(id) };
  const from = capital(called(m.from));
  if (m.to === STAKEHOLDER) return { key: `message:${id}`, label: `${from}'s message to you`, path: `people/${encodeURIComponent(m.from)}` };
  return { key: `message:${id}`, label: `${from}'s message to ${called(m.to)}`, path: `people/${encodeURIComponent(m.from)}` };
}

export function decisionEntry(company: DecisionCompany, d: Decision, now: number): DecisionEntry {
  const enc = encodeURIComponent;
  const name = (id: string) => nameOf(company, id);
  const by = d.by === THE_OFFICE ? 'the office' : name(d.by).subject;
  const links: DecisionLink[] = [];
  const l = d.links;
  if (l.message !== undefined) links.push(messageLink(company, l.message));
  if (l.task !== undefined) {
    const t = company.tasks.find((x) => x.id === l.task);
    links.push({ key: `task:${l.task}`, label: t ? `Task: ${said(t.title, 80)}` : 'The task', path: `tasks/${enc(l.task)}` });
  }
  if (l.question !== undefined) links.push({ key: `question:${l.question}`, label: 'The question', path: inboxItemPath(l.question) });
  if (l.approval !== undefined) links.push({ key: `approval:${l.approval}`, label: 'The approval', path: inboxItemPath(l.approval) });
  if (l.planVersion !== undefined) links.push({ key: `plan:${l.planVersion}`, label: `Version ${l.planVersion} of the plan`, path: planPath(l.planVersion) });
  if (l.decision !== undefined) {
    const label = d.kind === 'undo' ? 'The decision it undid' : d.kind === 'reconsider' ? 'The decision to reconsider' : 'The decision it follows';
    links.push({ key: `decision:${l.decision}`, label, path: decisionPath(l.decision) });
  }
  const decider = d.by !== STAKEHOLDER && d.by !== THE_OFFICE ? (company.people.find((p) => p.id === d.by) ?? null) : null;
  return {
    id: d.id,
    what: endSentence(said(d.what, 300)),
    by: `By ${by} ${atWords(d.at, now)}.`,
    tag: KIND_WORDS[d.kind]?.tag ?? capital(d.kind),
    why: d.why ? said(d.why, 1000) : null,
    alternatives: d.alternatives.map((a) => said(a, 300)).filter(Boolean),
    links,
    undone: d.undone ? { text: `Undone by ${name(d.undone.by).called} ${atWords(d.undone.at, now)}.`, path: decisionPath(d.undone.decision) } : null,
    reconsidered: d.reconsider
      ? { text: `You asked ${name(d.by).called} to reconsider ${atWords(d.reconsider.at, now)}: “${said(d.reconsider.note, 300)}”`, path: tracePath(d.reconsider.message) }
      : null,
    canUndo: d.reversible && d.undone === null,
    reconsiderTo: decider && d.undone === null ? { id: decider.id, name: nameOf(company, decider.id).called } : null,
  };
}

/** The undo that took a decision back, when it can be undone in turn: what "Undo" under "Undone." presses. */
export function redoOf(decisions: readonly Decision[], id: string): string | null {
  const undone = decisions.find((d) => d.id === id)?.undone;
  if (!undone) return null;
  const undo = decisions.find((d) => d.id === undone.decision);
  return undo && undo.reversible && undo.undone === null ? undo.id : null;
}

/** What a press left on an entry: "Undoing…", "Undone." for its undo window, a reconsider sent, a refusal. */
export type DecisionNote = { kind: 'busy' | 'sent' | 'failed' | 'redone'; text: string } | { kind: 'undone'; text: string; until: number };

/** When a note leaves the entry by itself: "Undone." at the end of its undo window. The others stay. */
export const noteEnds = (note: DecisionNote | null): number | null => (note?.kind === 'undone' ? note.until : null);

/**
 * What the note shows: "Undone. Undo" while the undo can itself be undone, else the plain line. "Undone." goes when its
 * window ends (`ended`) either way, so the plain one never stays behind on an undo that can't be undone.
 */
export function noteView(note: DecisionNote | null, canRedo: boolean, ended: boolean): 'undo-line' | 'line' | null {
  if (!note || note.kind === 'busy') return null;
  if (note.kind !== 'undone') return 'line';
  if (ended) return null;
  return canRedo ? 'undo-line' : 'line';
}

// ---------------------------------------------------------------------------------------------------------------
// Days and pages

/** "Today", "Yesterday", then the day: "Mon 3 Nov". */
export function dayHeading(at: number, now: number): string {
  const days = daysAgo(at, now);
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : dayLabel(at, now);
}

/** Decisions under their day's heading, in the order given (newest first). */
export function byDay(decisions: readonly Decision[], now: number): { heading: string; decisions: Decision[] }[] {
  const days: { heading: string; decisions: Decision[] }[] = [];
  for (const d of decisions) {
    const heading = dayHeading(d.at, now);
    const last = days.at(-1);
    if (last?.heading === heading) last.decisions.push(d);
    else days.push({ heading, decisions: [d] });
  }
  return days;
}

/** How many to show: whole pages, enough to hold the decision an address names. */
export function shownCount(filtered: readonly Decision[], pages: number, focus: string | null): number {
  const at = focus === null ? -1 : filtered.findIndex((d) => d.id === focus);
  const needed = at < 0 ? 0 : Math.ceil((at + 1) / DECISION_PAGE);
  return Math.min(filtered.length, Math.max(pages, needed) * DECISION_PAGE);
}

/** "Show 50 more" with what is left: "Show 50 more (212 left)". */
export function moreLine(left: number): string {
  return left <= DECISION_PAGE ? `Show the last ${left <= 12 ? countWord(left) : left}` : `Show ${DECISION_PAGE} more (${left} left)`;
}
