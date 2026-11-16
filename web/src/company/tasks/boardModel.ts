// Steering the task board (SPEC-v3.md "Steering", 4): the order work is handed out in and moving a task in it, pause
// and resume, cancel with a reason and where the work stays, reassign with a handover note, a task you create for
// anyone (and whose head is told), and the plan task a task came from. Pure, so it can be tested; Board.tsx draws it.
import { chainUp, type CompanyView, LIMITS, type PersonView, type Task } from '../../../../src/core/company.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import { PLAN_LIMITS, type NewTaskInput } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { introduced, nameOf, type Tone } from '../people/peopleModel.ts';
import { filesFrom, filesProblems, named, placeWord, sharePath } from '../plan/planEdit.ts';
import { TASK_TONE, TASK_WORD, taskRow } from './tasksModel.ts';

export const isOpenTask = (t: Task): boolean => t.status !== 'done' && t.status !== 'dropped';

/**
 * "14:32" (or "2:32 PM"): lib/format's hourMinute, from one formatter kept for every note. Making a formatter, which
 * toLocaleTimeString does on each call, costs about twenty times as much as using one, and a board says a time on
 * every done, cancelled and paused note.
 */
const clockFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
export const clockAt = (at: number): string => clockFormat.format(at);
const byId = (a: Task, b: Task) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const rank = (t: Task) => t.priority ?? Number.POSITIVE_INFINITY;

// ---------------------------------------------------------------------------------------------------------------
// Priority

/** Open tasks in the order work is handed out: by priority (lower first), then in the order they were asked for. */
export function priorityOrder(tasks: readonly Task[]): Task[] {
  return tasks.filter(isOpenTask).sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || a.createdAt - b.createdAt || byId(a, b));
}

/** Up or down one, or to the top or bottom; null when it is already there. */
export function moveInOrder(ids: readonly string[], id: string, where: 'up' | 'down' | 'top' | 'bottom'): string[] | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const to = where === 'up' ? i - 1 : where === 'down' ? i + 1 : where === 'top' ? 0 : ids.length - 1;
  if (to === i || to < 0 || to >= ids.length) return null;
  const rest = ids.filter((x) => x !== id);
  return [...rest.slice(0, to), id, ...rest.slice(to)];
}

/** A drop before a task (or, with null, at the end); null when it lands where it is. */
export function dropInOrder(ids: readonly string[], id: string, before: string | null): string[] | null {
  const i = ids.indexOf(id);
  if (i < 0 || before === id || (before !== null && !ids.includes(before))) return null;
  if ((before === null && i === ids.length - 1) || (before !== null && ids[i + 1] === before)) return null;
  const rest = ids.filter((x) => x !== id);
  const at = before === null ? rest.length : rest.indexOf(before);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The order to show while yours is on its way to the office: yours for the tasks it holds, and tasks that came since
 * (or that it didn't know) where the office has them, after the task they follow there. Tasks gone since leave it.
 */
export function withPending(server: readonly string[], pending: readonly string[] | null): string[] {
  if (!pending) return [...server];
  const here = new Set(server);
  const out = pending.filter((id) => here.has(id));
  const known = new Set(out);
  server.forEach((id, i) => {
    if (known.has(id)) return;
    const previous = i > 0 ? server[i - 1] : undefined;
    const at = previous === undefined ? 0 : out.indexOf(previous) + 1;
    out.splice(at, 0, id);
    known.add(id);
  });
  return out;
}

/** "Fifth of 24 in line." */
export function placeLine(order: readonly string[], id: string): string | null {
  const i = order.indexOf(id);
  if (i < 0) return null;
  return order.length === 1 ? 'The only task in line.' : `${capital(placeWord(i + 1))} of ${countWord(order.length)} in line.`;
}

/** What a move says: "Moved “Cart”: now second of 14 in line." */
export const movedLine = (order: readonly string[], task: Task): string => `Moved ${named(task.title)}: now ${(placeLine(order, task.id) ?? '').replace(/^\w/, (c) => c.toLowerCase())}`;

// ---------------------------------------------------------------------------------------------------------------
// A task's steering, in sentences

const whoDid = (company: Pick<CompanyView, 'people'>, by: string): string => nameOf(company, by).called;

/** "Paused by you at 14:02." */
export function pausedLine(company: Pick<CompanyView, 'people'>, t: Task): string | null {
  if (!t.paused || !isOpenTask(t)) return null;
  return `Paused by ${whoDid(company, t.paused.by)} at ${clockAt(t.paused.at)}.`;
}

/** "Cancelled by you at 14:20: not needed for the launch." */
export function cancelLine(company: Pick<CompanyView, 'people'>, t: Task): string | null {
  if (!t.cancel) return null;
  const why = clip(plainText(t.cancel.reason), 160).replace(/[.\s]+$/, '');
  return `Cancelled by ${whoDid(company, t.cancel.by)} at ${clockAt(t.cancel.at)}${why ? `: ${why}` : ''}.`;
}

/** Where a cancelled task's work stays: its branch, or why there is none. */
export function branchLine(company: Pick<CompanyView, 'branch'>, t: Task): { text: string; branch: string | null } | null {
  if (!t.cancel) return null;
  if (t.cancel.branch) return { text: 'The work stays on its branch:', branch: t.cancel.branch };
  return { text: company.branch === null ? "The project isn't a git repository, so no branch keeps the work." : 'Nothing had changed, so no branch keeps it.', branch: null };
}

/** Before you cancel: where the work will stay. */
export function cancelHint(company: Pick<CompanyView, 'people' | 'branch'>, t: Task): string {
  const owner = capital(nameOf(company, t.owner).called);
  if (t.worktree) return `${owner} stops, and the work stays on its branch, ${t.worktree.branch}.`;
  if (company.branch === null) return `${owner} stops. The project isn't a git repository, so what changed stays as it is.`;
  return `${owner} stops, and what they changed is kept on a branch named after the task.`;
}

/** Handovers in sentences, oldest first: "You moved it from Kai to Noah at 14:30: “Take the cart.”" */
export function handoverLines(company: Pick<CompanyView, 'people'>, t: Task): string[] {
  return (t.handovers ?? []).map((h) => {
    const note = clip(plainText(h.note), 240);
    return `${capital(whoDid(company, h.by))} moved it from ${whoDid(company, h.from)} to ${whoDid(company, h.to)} at ${clockAt(h.at)}${note ? `: “${note}”` : '.'}`;
  });
}

/** The plan task it came from, found in the newest version that has it. */
export function planOrigin(company: Pick<CompanyView, 'steering'>, t: Task): { title: string; milestone: string | null; version: number } | null {
  if (!t.planTask) return null;
  const versions = company.steering?.plan?.versions ?? [];
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const v = versions[i];
    const p = v?.plan.tasks.find((x) => x.id === t.planTask);
    if (v && p) return { title: plainText(p.title), milestone: v.plan.milestones.find((m) => m.id === p.milestone)?.title ?? null, version: v.version };
  }
  return null;
}

/** "From the plan: “Slot picker”, in “Pickup orders work”." */
export function originLine(company: Pick<CompanyView, 'steering'>, t: Task): string | null {
  const o = planOrigin(company, t);
  if (!o) return t.planTask ? 'From the plan.' : null;
  return `From the plan: ${named(o.title)}${o.milestone ? `, in ${named(o.milestone)}` : ''}.`;
}

/** A task's word and tone with steering: "Paused", "Cancelled", or its status's. */
export function steeredWord(t: Task): { word: string; tone: Tone } {
  if (t.cancel) return { word: 'Cancelled', tone: 'neutral' };
  if (t.paused && isOpenTask(t)) return { word: 'Paused', tone: 'rest' };
  return { word: TASK_WORD[t.status], tone: TASK_TONE[t.status] };
}

/** The row's line, steering first: a paused or cancelled task says so; anything else reads as before. */
export function steeredRow(company: CompanyView, t: Task, now: number, changed?: number): { title: string; line: string; answer: string | null } {
  const row = taskRow(company, t, now, changed);
  const paused = pausedLine(company, t);
  if (paused) return { ...row, line: `${capital(nameOf(company, t.owner).introduced)}. ${paused}` };
  const cancelled = cancelLine(company, t);
  if (cancelled) return { ...row, line: cancelled, answer: null };
  return row;
}

/** What you can do with a task now. */
export function steerable(t: Task): { pause: boolean; resume: boolean; cancel: boolean; reassign: boolean; order: boolean } {
  const open = isOpenTask(t);
  return { pause: open && !t.paused, resume: open && !!t.paused, cancel: open, reassign: open, order: open };
}

// ---------------------------------------------------------------------------------------------------------------
// Reassigning and creating

/** A person as a choice in a list: "Kai, frontend engineer", "The QA engineer", "The CEO". */
export const choiceName = (p: Pick<PersonView, 'name' | 'title' | 'level'>): string => capital(introduced(p));

/**
 * People by room, for choosing who does something: rooms as the org lists them (a `first` room leads), people by name,
 * and `except` left out. `roomName` gives a room its name.
 */
export function peopleByRoom(
  company: Pick<CompanyView, 'people'>,
  roomName: (room: string) => string,
  options: { except?: string | null; first?: string | null } = {},
): { room: string; name: string; people: PersonView[] }[] {
  const rooms: string[] = [];
  for (const p of company.people) if (!rooms.includes(p.room)) rooms.push(p.room);
  const first = options.first ?? null;
  const order = first !== null && rooms.includes(first) ? [first, ...rooms.filter((r) => r !== first)] : rooms;
  return order
    .map((room) => ({ room, name: roomName(room), people: company.people.filter((p) => p.room === room && p.id !== options.except).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.people.length > 0);
}

/** Everyone but the owner, who can take a task over: the owner's room first (their teammates), then by room and name. */
export function reassignChoices(company: Pick<CompanyView, 'people'>, t: Task): PersonView[] {
  const room = company.people.find((p) => p.id === t.owner)?.room ?? null;
  return company.people
    .filter((p) => p.id !== t.owner)
    .sort((a, b) => Number(b.room === room) - Number(a.room === room) || a.room.localeCompare(b.room) || a.name.localeCompare(b.name));
}

/** "Kai stops, and Noah gets the brief, your note and what Kai did so far." */
export function handoverHint(company: Pick<CompanyView, 'people'>, t: Task, to: string): string {
  const from = nameOf(company, t.owner).called;
  return `${capital(from)} stops, and ${nameOf(company, to).called} gets the brief, your note and what ${from} did so far.`;
}

/** Who hears of a task you create for someone: their head, else their manager; nobody for the CEO. */
export function headOf(company: Pick<CompanyView, 'people'>, owner: string): PersonView | null {
  const chain = chainUp(company.people, owner);
  const head = chain.find((p) => p.level === 'head') ?? chain[0];
  return head ? (company.people.find((p) => p.id === head.id) ?? null) : null;
}

/** "Ben, head of engineering, is told." */
export function toldLine(company: Pick<CompanyView, 'people'>, owner: string): string | null {
  const head = headOf(company, owner);
  if (!head) return null;
  const who = introduced(head);
  return `${capital(who)}${who.includes(',') ? ',' : ''} is told.`;
}

/** A new task as you type it. */
export interface NewTaskDraft {
  title: string;
  brief: string;
  /** One per line. */
  files: string;
  owner: string;
  doneWhen: string;
  milestone: string | null;
}

export const blankTask = (owner: string): NewTaskDraft => ({ title: '', brief: '', files: '', owner, doneWhen: '', milestone: null });

export { sharePath };

/** Files an open task already holds: no two open tasks share one. */
export function sharedFiles(company: Pick<CompanyView, 'tasks'>, files: readonly string[], except: string | null = null): { file: string; task: Task }[] {
  const out: { file: string; task: Task }[] = [];
  for (const file of files) {
    const task = company.tasks.find((t) => t.id !== except && isOpenTask(t) && t.files.some((f) => sharePath(f, file)));
    if (task) out.push({ file, task });
  }
  return out;
}

export type NewTaskField = 'title' | 'owner' | 'files' | 'brief' | 'doneWhen';

/** What stops a new task, by field, each a sentence with the fix. The office checks it again. */
export function checkNewTask(d: NewTaskDraft, company: Pick<CompanyView, 'people' | 'tasks' | 'goal'>): { field: NewTaskField; text: string }[] {
  const out: { field: NewTaskField; text: string }[] = [];
  const title = d.title.trim();
  if (!title) out.push({ field: 'title', text: 'Give the task a title.' });
  else if (title.length > LIMITS.title) out.push({ field: 'title', text: `The title is ${title.length} characters. Shorten it to ${LIMITS.title}.` });
  if (!company.people.some((p) => p.id === d.owner)) out.push({ field: 'owner', text: 'Pick who does it.' });
  if (!d.brief.trim()) out.push({ field: 'brief', text: 'Say what to do in the brief: it is all they start from.' });
  else if (d.brief.length > LIMITS.brief) out.push({ field: 'brief', text: `The brief is ${d.brief.length.toLocaleString('en-US')} characters. Shorten it to ${LIMITS.brief.toLocaleString('en-US')}.` });
  const files = filesFrom(d.files);
  const fileProblem = filesProblems(files, 'The task')[0];
  if (fileProblem) out.push({ field: 'files', text: fileProblem });
  else {
    const shared = sharedFiles(company, files)[0];
    if (shared) out.push({ field: 'files', text: `${shared.file} is in ${named(shared.task.title)}, an open task of ${nameOf(company, shared.task.owner).called}'s. Open tasks never share a file: pick others, or wait until it's done.` });
  }
  if (!d.doneWhen.trim()) out.push({ field: 'doneWhen', text: "Say when it's done, so they know when to stop." });
  else if (d.doneWhen.length > PLAN_LIMITS.doneWhen) out.push({ field: 'doneWhen', text: `That is ${d.doneWhen.length.toLocaleString('en-US')} characters. Shorten it to ${PLAN_LIMITS.doneWhen.toLocaleString('en-US')}.` });
  return out;
}

export const newTaskInput = (d: NewTaskDraft): NewTaskInput => ({ title: d.title.trim(), brief: d.brief.trim(), files: filesFrom(d.files), owner: d.owner, doneWhen: d.doneWhen.trim(), milestone: d.milestone });

/** What creating it says: "Added “Fix the footer” for Kai. Ben, head of engineering, is told." */
export function createdLine(company: Pick<CompanyView, 'people'>, t: Pick<Task, 'title' | 'owner'>): string {
  const told = toldLine(company, t.owner);
  return `Added ${named(t.title)} for ${nameOf(company, t.owner).called}.${told ? ` ${told}` : ''}`;
}

/** "It reaches Kai in priority order, after the three open tasks ahead of it." */
export function reachesLine(company: Pick<CompanyView, 'people' | 'tasks'>, owner: string): string {
  const who = nameOf(company, owner).called;
  const ahead = company.tasks.filter((t) => t.owner === owner && isOpenTask(t)).length;
  return ahead === 0 ? `It reaches ${who} first: nothing else is open for them.` : `It reaches ${who} in priority order, after ${ahead === 1 ? 'their open task' : `their ${countWord(ahead)} open tasks`}; move it up the board to make it sooner.`;
}

/** Said once a steering action is taken. */
export const steerSaid = {
  paused: (company: Pick<CompanyView, 'people'>, t: Task) => `Paused ${named(t.title)}. ${capital(nameOf(company, t.owner).called)} stops and waits.`,
  resumed: (company: Pick<CompanyView, 'people'>, t: Task) => `Resumed ${named(t.title)}. ${capital(nameOf(company, t.owner).called)} carries on.`,
  cancelled: (t: Task) => `Cancelled ${named(t.title)}.`,
  reassigned: (company: Pick<CompanyView, 'people'>, t: Task, to: string) => `Moved ${named(t.title)} to ${nameOf(company, to).called}.`,
};

/** The decision that cancelled a task, while Undo can still take it back. */
export function cancelDecision(company: Pick<CompanyView, 'steering'>, t: Task): string | null {
  if (!t.cancel) return null;
  const decisions = company.steering?.decisions ?? [];
  for (let i = decisions.length - 1; i >= 0; i -= 1) {
    const d = decisions[i];
    if (d && d.kind === 'task' && d.links.task === t.id && d.at >= t.cancel.at - 1000) return d.reversible && !d.undone ? d.id : null;
  }
  return null;
}

/**
 * Whether the order you made is still what is drawn: it is dropped once the office has taken it (`settledOn` is the
 * office's order when it did) and the stream then shows yours or moves on from that order.
 */
export function pendingSettled(server: readonly string[], pending: readonly string[] | null, settledOn: string | null): boolean {
  if (!pending || settledOn === null) return false;
  return sameOrder(server, withPending(server, pending)) || server.join('\n') !== settledOn;
}

/**
 * Sends the priority order one request at a time: an order made while one is on its way waits (only the latest waits),
 * and goes when that one is answered. `settled` runs when nothing waits any more; a refusal drops what waited and runs
 * `refused`, so the office's order is put back.
 */
export class OrderQueue {
  private busy = false;
  private waiting: string[] | null = null;
  private readonly send: (order: string[]) => Promise<unknown>;
  private readonly on: { started: () => void; settled: () => void; refused: (error: unknown) => void };

  constructor(send: (order: string[]) => Promise<unknown>, on: { started: () => void; settled: () => void; refused: (error: unknown) => void }) {
    this.send = send;
    this.on = on;
  }

  get sending(): boolean {
    return this.busy;
  }

  push(order: string[]): void {
    if (this.busy) this.waiting = order;
    else this.start(order);
  }

  private start(order: string[]): void {
    this.busy = true;
    this.on.started();
    this.send(order).then(
      () => {
        this.busy = false;
        const again = this.waiting;
        this.waiting = null;
        if (again) this.start(again);
        else this.on.settled();
      },
      (error: unknown) => {
        this.busy = false;
        this.waiting = null;
        this.on.refused(error);
      },
    );
  }
}
