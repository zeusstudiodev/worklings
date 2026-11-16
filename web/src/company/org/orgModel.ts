// What the org chart says about each person and about itself (docs/design-v3.md, "The org chart"): a node's state chip
// and work line, its name and description for screen readers, a chip's label, a folded manager's line, Find someone,
// the board's sentence, which rooms start closed, and the papers a new message sends along the lines. Pure, so it is
// tested (test/panels-org-layout.test.ts); OrgBoard draws it.
import { type CompanyView, type PersonView, STAKEHOLDER } from '../../../../src/core/company.ts';
import { clip, coarseDuration, countWord, plainText } from '../../../../src/core/now.ts';
import { inSentence } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';
import { dollars, hourMinute } from '../../lib/format.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { modelName } from '../person/personModel.ts';
import { isAtWork, needsYou, ordinal, taskOf, type Work, type WorkKind, workOf } from '../people/peopleModel.ts';
import { type OrgMember, YOU } from './orgLayout.ts';

/** The chip's look: its colour and its mark's shape (never colour alone; the words say it too). */
export type ChipKind = 'working' | 'needs' | 'waiting' | 'blocked' | 'stuck' | 'idle' | 'off' | 'away' | 'paused';

const CHIP_OF: Record<WorkKind, ChipKind> = {
  working: 'working',
  starting: 'working',
  stopping: 'working',
  'needs-ok': 'needs',
  'needs-answer': 'needs',
  waiting: 'waiting',
  blocked: 'blocked',
  stuck: 'stuck',
  idle: 'idle',
  off: 'off',
  away: 'away',
  paused: 'paused',
};

/** Urgency, most first: what a folded manager's line says about who is under them. */
const URGENCY: ChipKind[] = ['needs', 'stuck', 'blocked', 'working', 'waiting', 'paused', 'away', 'idle', 'off'];

export interface NodeWords {
  /** "Kai". */
  name: string;
  title: string;
  /** The state chip: "Working", "Needs your OK", "Stuck for 4 min". */
  chip: string;
  kind: ChipKind;
  /** The work line beside the chip: the task, the request's first words, "Second in line.". */
  line: string;
  /** "Sonnet". */
  model: string;
  /** "$4.66". */
  cost: string;
  /** The node's name: who and how they are. "Kai, frontend engineer, Engineering. Needs your OK: push the work branch to GitHub." */
  label: string;
  /** Figures that tick, so a focused node doesn't repeat itself: "For 12 min. Sonnet, $4.66. Shift+F10 for more." */
  description: string;
  work: Work;
}

/** Working this long says for how long on the node. */
const SAY_FOR_FROM_MS = 10 * 60_000;

const first = (text: string, max = 80) => clip(plainText(text).replace(/\s+/g, ' ').trim(), max);

/** What a node says about someone now (design-v3's table: the chip and the line per state). */
export function nodeWords(company: CompanyView, p: PersonView, now: number, roomName: (room: string) => string, extra: { moved?: string | null; lostManager?: string | null; more?: boolean } = {}): NodeWords {
  const work = workOf(company, p, now);
  const task = taskOf(company, p.task);
  const taskLine = task ? first(task.title) : p.status ? first(p.status.text) : '';
  let line = '';
  let sentence = false;
  let chip = work.word;
  let forHow = '';
  // What the node's name says in place of `chip` and `line` when they hold a figure that ticks (a duration): the name is
  // re-read as minutes pass, so those figures go to the description instead.
  let nameChip = '';
  let nameLine: string | null = null;
  switch (work.kind) {
    case 'working': {
      line = taskLine || 'On it.';
      sentence = !taskLine;
      const long = now - p.desk.since;
      if (long >= SAY_FOR_FROM_MS) forHow = `For ${coarseDuration(long)}.`;
      if (forHow && taskLine) {
        line = `${taskLine}, for ${coarseDuration(long)}`;
        nameLine = taskLine;
      }
      break;
    }
    case 'needs-ok': {
      const a = company.approvals.find((x) => x.id === work.item);
      line = a ? first(a.summary) : '';
      break;
    }
    case 'needs-answer': {
      const q = company.questions.find((x) => x.id === work.item);
      line = q ? first(q.text) : '';
      break;
    }
    case 'waiting':
      line = p.desk.queue ? `${capital(ordinal(p.desk.queue))} in line.` : 'Waits for a desk.';
      sentence = true;
      break;
    case 'blocked':
      line = first(work.line.replace(/\.$/, ''));
      break;
    case 'stuck':
      chip = `Stuck for ${coarseDuration(now - p.desk.since)}`;
      nameChip = work.word;
      forHow = `${chip}.`;
      break;
    case 'starting':
    case 'stopping':
    case 'paused':
      line = taskLine;
      break;
    case 'idle':
      line = 'Done for now.';
      sentence = true;
      break;
    case 'off': {
      const open = task && task.status !== 'done' && task.status !== 'dropped';
      line = open ? first(task.title) : 'Nothing assigned.';
      sentence = !open;
      break;
    }
    case 'away':
      line = `With you since ${hourMinute(p.desk.since)}.`;
      nameLine = 'With you.';
      forHow = line;
      sentence = true;
      break;
  }
  const who = `${personLabel(p)}, ${roomName(p.room)}`;
  const saidChip = nameChip || chip;
  const saidLine = nameLine ?? line;
  const how = saidLine ? (sentence ? `${saidChip}. ${saidLine}` : `${saidChip}: ${inLineText(saidLine)}${saidLine.endsWith('…') ? '' : '.'}`) : `${saidChip}.`;
  const notes = [extra.moved ? `In ${extra.moved} now, still reporting here.` : '', extra.lostManager ? `Reported to ${extra.lostManager}, who left.` : ''].filter(Boolean).join(' ');
  const model = modelName(p.model);
  const cost = dollars(p.cost);
  return {
    name: p.name,
    title: p.title,
    chip,
    kind: CHIP_OF[work.kind],
    line,
    model,
    cost,
    label: [`${who}.`, how, notes].filter(Boolean).join(' '),
    description: [forHow, `${model}, ${cost}.`, extra.more === false ? '' : 'Shift+F10 for more.'].filter(Boolean).join(' '),
    work,
  };
}

/** A fragment inside a sentence: its first letter lower case unless it is a name or an acronym ("push the branch"). */
const inLineText = (text: string): string => inSentence(text).replace(/(?<!…)[.\s]+$/, '');

/** A chip's label: the first name, with the title's first word where two share it ("Sam, QA", "Sam, SEO"). Never two letters. */
export function chipLabels(people: readonly Pick<PersonView, 'id' | 'name' | 'title'>[]): Map<string, string> {
  const firstName = (p: Pick<PersonView, 'name'>) => p.name.trim().split(/\s+/)[0] ?? p.name;
  const count = new Map<string, number>();
  for (const p of people) count.set(firstName(p).toLowerCase(), (count.get(firstName(p).toLowerCase()) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of people) {
    const name = firstName(p);
    if ((count.get(name.toLowerCase()) ?? 0) > 1 && p.title !== p.name) {
      const word = p.title.trim().split(/\s+/)[0] ?? '';
      out.set(p.id, `${name}, ${word}`);
    } else out.set(p.id, name);
  }
  return out;
}

/** Who is under someone, as the company has it (folded or not). */
export function underOf(company: Pick<CompanyView, 'people'>, id: string): PersonView[] {
  const out: PersonView[] = [];
  const seen = new Set<string>([id]);
  const walk = (m: string) => {
    for (const p of company.people) {
      if (p.reportsTo !== m || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
      walk(p.id);
    }
  };
  walk(id);
  return out;
}

/** A folded manager's line: "+6", and "Six more under Theo, one needs you". */
export function foldWords(company: CompanyView, manager: PersonView, now: number): { pill: string; needs: number; line: string; most: ChipKind | null } {
  const under = underOf(company, manager.id);
  const works = under.map((p) => workOf(company, p, now));
  const needs = works.filter(needsYou).length;
  const kinds = new Set(works.map((w) => CHIP_OF[w.kind]));
  const most = URGENCY.find((k) => kinds.has(k)) ?? null;
  const more = `${capital(countWord(under.length))} more under ${manager.name}`;
  const why = needs > 0 ? `, ${countWord(needs)} ${needs === 1 ? 'needs' : 'need'} you` : most === 'stuck' ? ', someone is stuck' : most === 'working' ? `, ${countWord(works.filter(isAtWork).length)} at work` : '';
  return { pill: `+${under.length}`, needs, line: `${more}${why}.`, most };
}

/** People whose name, title or room matches what was typed, case and accents ignored. */
export function findMatches(people: readonly PersonView[], roomName: (room: string) => string, query: string): string[] {
  const q = searchable(query.trim());
  if (!q) return [];
  return people.filter((p) => [p.name, p.title, roomName(p.room)].some((field) => searchable(field).includes(q))).map((p) => p.id);
}

const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** "4 of 18 match", "Nobody matches “zo”.". */
export function matchLine(found: number, total: number, query: string): string {
  if (found === 0) return `Nobody matches “${clip(query.trim(), 40)}”.`;
  return `${found} of ${total} match`;
}

/** The board's sentence: "18 people in five rooms. Six at work." */
export function chartSentence(company: CompanyView, now: number): string {
  const n = company.people.length;
  if (n === 0) return 'Nobody works here yet.';
  const rooms = new Set(company.people.map((p) => p.room)).size;
  const atWork = company.people.filter((p) => isAtWork(workOf(company, p, now))).length;
  const people = n === 1 ? 'One person' : `${capital(countWord(n))} people`;
  const where = rooms === 1 ? 'in one room' : `in ${countWord(rooms)} rooms`;
  const work = atWork === 0 ? 'Nobody at work.' : `${capital(countWord(atWork))} at work.`;
  return `${people} ${where}. ${work}`;
}

/** Over this many people, rooms where nobody works or needs you start closed (People's rule). */
export const FOLD_OVER = 25;

/** The managers that start folded: over 25 people, heads whose room has nobody at work, stuck or needing you. */
export function startsFolded(company: CompanyView, now: number): Set<string> {
  const out = new Set<string>();
  if (company.people.length <= FOLD_OVER) return out;
  for (const head of company.people) {
    if (head.level !== 'head') continue;
    const under = underOf(company, head.id);
    if (under.length === 0) continue;
    const busy = under.some((p) => {
      const w = workOf(company, p, now);
      return isAtWork(w) || needsYou(w) || w.kind === 'stuck';
    });
    if (!busy) out.add(head.id);
  }
  return out;
}

/** Managers kept open so every match shows: their ancestors, while Find has words. */
export function openFor(company: Pick<CompanyView, 'people'>, ids: readonly string[]): Set<string> {
  const byId = new Map(company.people.map((p) => [p.id, p]));
  const out = new Set<string>();
  for (const id of ids) {
    let at = byId.get(id)?.reportsTo ?? null;
    const seen = new Set<string>();
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      out.add(at);
      at = byId.get(at)?.reportsTo ?? null;
    }
  }
  return out;
}

/** The members the layout reads, from the company's people. */
export const membersOf = (people: readonly Pick<PersonView, 'id' | 'reportsTo' | 'level' | 'room'>[]): OrgMember[] => people.map((p) => ({ id: p.id, reportsTo: p.reportsTo, level: p.level, room: p.room }));

/**
 * Someone moved to another room without a new manager: they are in a room that has a head of its own, and still report
 * to someone in another room (the CEO doesn't count). A room without a head is managed from another room by design.
 */
export function movedRoom(company: Pick<CompanyView, 'people'>, p: PersonView): string | null {
  const m = p.reportsTo === null ? undefined : company.people.find((x) => x.id === p.reportsTo);
  if (!m || m.level === 'ceo' || m.room === p.room) return null;
  const head = company.people.find((x) => x.level === 'head' && x.room === p.room);
  return head && head.id !== m.id && head.id !== p.id ? p.room : null;
}

/** Where focus goes when someone leaves: their manager on the chart, else the CEO. */
export function focusAfterLeaving(company: Pick<CompanyView, 'people'>, gone: Pick<PersonView, 'reportsTo'>): string | null {
  if (gone.reportsTo !== null && company.people.some((p) => p.id === gone.reportsTo)) return gone.reportsTo;
  return company.people.find((p) => p.level === 'ceo')?.id ?? company.people[0]?.id ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Papers along the lines

/** A message between two people the chart shows: a paper from one node to the other. Yours start from "You". */
export interface Relay {
  key: string;
  from: string;
  to: string;
  /** It carries your words: a yellow paper, else white. */
  yours: boolean;
}

/** At most this many papers fly at once; past that, receivers only ring. */
export const MAX_PAPERS = 6;

/**
 * The papers new messages and reports send, from what changed between two views of the company: one per message
 * between people on the chart (an all-hands sends one to each head); reports to a manager too. `seen` holds the ids of
 * what was there before.
 */
export function newRelays(company: Pick<CompanyView, 'people' | 'messages' | 'reports'>, seen: ReadonlySet<string>): { relays: Relay[]; rings: string[] } {
  const ids = new Set(company.people.map((p) => p.id));
  const relays: Relay[] = [];
  const rings: string[] = [];
  const groups = new Set<string>();
  for (const m of company.messages) {
    if (seen.has(m.id)) continue;
    const yours = m.from === STAKEHOLDER || m.origin === STAKEHOLDER;
    const from = m.from === STAKEHOLDER ? YOU : m.from;
    if (from !== YOU && !ids.has(from)) continue;
    if (!ids.has(m.to)) continue;
    if (m.audience?.kind === 'everyone') {
      // One paper to each head, then every node rings.
      if (groups.has(m.audience.group)) continue;
      groups.add(m.audience.group);
      for (const head of company.people.filter((p) => p.level === 'head')) relays.push({ key: `${m.id}:${head.id}`, from, to: head.id, yours });
      rings.push(...company.people.map((p) => p.id));
      continue;
    }
    relays.push({ key: m.id, from, to: m.to, yours });
  }
  for (const r of company.reports) {
    if (seen.has(r.id) || !ids.has(r.person) || !ids.has(r.to)) continue;
    relays.push({ key: r.id, from: r.person, to: r.to, yours: false });
  }
  return { relays, rings };
}

/** The ids `newRelays` compares against: every message and report there now. */
export const relaySeen = (company: Pick<CompanyView, 'messages' | 'reports'>): Set<string> => new Set([...company.messages.map((m) => m.id), ...company.reports.map((r) => r.id)]);

/** How long a paper takes: 300 ms a hop, 1.2 s at most. */
export const paperMs = (hops: number): number => Math.min(1200, 300 * Math.max(1, hops));

/** With reduced motion: the receiver's work line says who it came from for 4 s. */
export const fromLine = (company: Pick<CompanyView, 'people'>, from: string): string => (from === YOU ? 'From you' : `From ${company.people.find((p) => p.id === from)?.name ?? 'a colleague'}`);
