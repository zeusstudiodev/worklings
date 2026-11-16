// What the org tools say back: sentences the model can act on, the org chart, the tasks and the library in a few lines
// each. Names follow the office's copy (`introduce`), so a person reads the same everywhere.
import {
  type CatalogueEntry,
  type CompanyView,
  type DeskState,
  introduce,
  type Person,
  personById,
  type PersonView,
  STAKEHOLDER,
  type Task,
  type TaskStatus,
  THE_OFFICE,
} from '../core/company.ts';
import { inSentence } from '../core/studio.ts';
import { capital } from '../core/words.ts';
import { andList } from './schema.ts';

/** "Kai", or "the QA engineer" for a role without a first name. */
export const nameOf = (p: Pick<Person, 'name' | 'title'>): string => (p.name === p.title ? `the ${inSentence(p.title)}` : p.name);

/** A person, the stakeholder or the office in a sentence: "Ada, head of design". */
export function who(people: readonly Person[], id: string): string {
  if (id === STAKEHOLDER) return 'the stakeholder';
  if (id === THE_OFFICE) return 'the office';
  const p = personById(people, id);
  return p ? introduce(p) : id;
}

/** A person's first name, or their title, at the start of a sentence. */
export function named(people: readonly Person[], id: string): string {
  const p = personById(people, id);
  return p ? capital(nameOf(p)) : id;
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  queued: 'queued',
  working: 'in progress',
  blocked: 'blocked',
  review: 'waiting for review',
  done: 'done',
  dropped: 'dropped',
};
export const statusWords = (status: TaskStatus): string => STATUS_WORDS[status];

export const isOpen = (t: Pick<Task, 'status'>): boolean => t.status !== 'done' && t.status !== 'dropped';

/** `"Build the streak card" (t-12)`. */
export const taskLabel = (t: Pick<Task, 'id' | 'title'>): string => `"${t.title}" (${t.id})`;

/** A desk worth mentioning in the chart; the usual states (closed, idle, starting) say nothing. */
const DESK_WORDS: Partial<Record<DeskState, string>> = {
  working: 'working now',
  waiting: 'waiting for a desk',
  stopping: 'being stopped',
  failed: 'stuck',
  away: 'handed over to the stakeholder',
};

const MAX_FILES_SHOWN = 6;
const files = (list: readonly string[]): string =>
  list.length <= MAX_FILES_SHOWN ? list.join(', ') : `${list.slice(0, MAX_FILES_SHOWN).join(', ')} and ${list.length - MAX_FILES_SHOWN} more`;

/** The org chart in words: from the CEO down, who reports to whom, rooms, and who is on what right now. */
export function chartInWords(view: CompanyView, me: Person): string {
  const people = view.people;
  const tasks = new Map(view.tasks.map((t) => [t.id, t]));
  const stakeholder = view.stakeholder ? `the stakeholder (${view.stakeholder})` : 'the stakeholder';
  const lines: string[] = [`The org of ${view.name}: ${people.length === 1 ? '1 person' : `${people.length} people`}. You are ${introduce(me)} (${me.id}).`];
  if (view.goal) lines.push(`Goal: ${view.goal.text}`);
  if (view.phase === 'founding') lines.push('The CEO is drafting the org.');
  if (view.phase === 'proposed' && view.proposal) lines.push(`The CEO's proposal of ${view.proposal.people.length} people waits for the stakeholder.`);
  lines.push('');

  const line = (p: PersonView, depth: number) => {
    const manager = p.reportsTo === null ? (p.level === 'ceo' ? `, reports to ${stakeholder}` : '') : `, reports to ${named(people, p.reportsTo)}`;
    const task = p.task === null ? undefined : tasks.get(p.task);
    const doing = task ? `on ${taskLabel(task)}, ${statusWords(task.status)}` : p.task ? `on ${p.task}` : 'no task';
    const desk = DESK_WORDS[p.desk.state];
    const says = p.status ? ` Latest: "${p.status.text}"` : '';
    lines.push(`${'  '.repeat(depth)}${capital(introduce(p))} (${p.id}), ${p.room}${manager}: ${doing}${desk ? `, ${desk}` : ''}.${says}`);
  };
  // Depth first from the top; anyone the walk doesn't reach (a manager who left) is listed after.
  const seen = new Set<string>();
  const walk = (p: PersonView, depth: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    line(p, depth);
    for (const report of people.filter((q) => q.reportsTo === p.id)) walk(report, depth + 1);
  };
  for (const top of people.filter((p) => p.reportsTo === null || !personById(people, p.reportsTo))) walk(top, 0);
  for (const rest of people) walk(rest, 0);

  const rooms = new Map<string, string[]>();
  for (const p of people) rooms.set(p.room, [...(rooms.get(p.room) ?? []), nameOf(p)]);
  lines.push('', `Rooms: ${[...rooms].map(([room, names]) => `${room} (${andList(names)})`).join('; ')}.`);
  if (view.rooms.length > 0) lines.push(`Also in the office: ${andList(view.rooms.map((r) => `${inSentence(r.title)} (${r.id})`))}.`);
  // Their ids, so the CEO can take one down when the stakeholder asks.
  if (view.dashboards.length > 0) lines.push(`Published dashboards: ${andList(view.dashboards.map((d) => `"${d.title}" (${d.id})`))}.`);
  return lines.join('\n');
}

/** One task in a line: id, title, owner, status and files. */
function taskLine(t: Task, people: readonly Person[]): string {
  const where = t.files.length > 0 ? `; files ${files(t.files)}` : '';
  return `- ${t.id} "${t.title}": ${named(people, t.owner)} (${t.owner}), ${statusWords(t.status)}${where}.`;
}

/** At most this many tasks in one answer. */
export const MAX_TASKS_LISTED = 50;

/** A list of tasks, open ones only unless `all`, with what was left out. */
export function tasksInWords(list: readonly Task[], people: readonly Person[], all: boolean): string {
  const shown = all ? [...list] : list.filter(isOpen);
  const closed = list.length - shown.length;
  const hidden = closed > 0 ? ` (${closed} done or dropped not shown; give status to see them)` : '';
  if (shown.length === 0) return `No ${all ? '' : 'open '}tasks${hidden}.`;
  const head = `${shown.length === 1 ? '1 task' : `${shown.length} tasks`}${hidden}:`;
  const lines = shown.slice(0, MAX_TASKS_LISTED).map((t) => taskLine(t, people));
  if (shown.length > MAX_TASKS_LISTED) lines.push(`And ${shown.length - MAX_TASKS_LISTED} more: filter by owner or status to see them.`);
  return [head, ...lines].join('\n');
}

/** One task in full: everything an owner or a reviewer needs. */
export function taskInFull(t: Task, people: readonly Person[]): string {
  const lines = [
    `${t.id} "${t.title}"`,
    `Owner: ${who(people, t.owner)} (${t.owner}). Asked by: ${who(people, t.askedBy)}. Status: ${statusWords(t.status)}.`,
    `Files: ${t.files.length > 0 ? t.files.join(', ') : 'none named'}.`,
    `Done when: ${t.doneWhen}`,
    `Brief: ${t.brief}`,
  ];
  if (t.outcome) lines.push(`Outcome: ${t.outcome}`);
  const links = [
    t.parent ? `Part of ${t.parent}.` : '',
    t.milestone ? `Milestone ${t.milestone}.` : '',
    t.worktree ? `Worktree on the branch ${t.worktree.branch}.` : '',
    t.commit ? `Finished in commit ${t.commit}.` : '',
  ].filter(Boolean);
  if (links.length > 0) lines.push(links.join(' '));
  return lines.join('\n');
}

/** The library as the CEO hires from it. */
export function catalogueInWords(entries: readonly CatalogueEntry[]): string {
  if (entries.length === 0) return 'The library has no roles to hire.';
  const head = `${entries.length === 1 ? '1 role' : `${entries.length} roles`} in the library (id: title, room, model, what it does):`;
  return [head, ...entries.map((e) => `- ${e.id}: ${e.title}, ${e.department}, ${e.model}. ${e.description}`)].join('\n');
}
