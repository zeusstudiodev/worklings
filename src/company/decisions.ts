// The decision log (SPEC-v3.md "Steering", 5), and what every steering module shares: the view of the company an
// operation reads (SteerCtx), what it gives back (steps of events to commit, each followed by effects for the company to
// carry out), names in sentences, and the check that someone acting for the stakeholder cites the stakeholder's word.
// Every steering action writes a Decision; Undo takes back the reversible ones through their inverse, and Reconsider
// sends one back to whoever made it. The operations are pure over the SteerCtx: the company commits the steps and runs
// the effects (deliveries, stops, git), so it stays a thin layer over them.
import { type CompanyEvent, type CompanyState, fold, type IdKind, isOpenTask } from '../core/company-state.ts';
import {
  type Approval,
  type DeskState,
  LIMITS,
  type Message,
  type OfficeChange,
  OrgRefusal,
  type Person,
  personById,
  type Question,
  STAKEHOLDER,
  THE_OFFICE,
} from '../core/company.ts';
import { oneLine } from '../core/events.ts';
import type { Theme } from '../core/looks.ts';
import { pathsOverlap } from '../core/plan.ts';
import { redactClip } from '../core/redact.ts';
import type { ReshapeResult } from '../core/snapshot.ts';
import { type Decision, type DecisionKind, DECISION_LIMITS, type DecisionLinks, type Effort, type Leash, type PlanApproval } from '../core/steering.ts';
import {
  reversibleIn,
  type SettingsUndo,
  type SteeringEvent,
  type SteeringIdKind,
  type SteeringState,
  type UndoPlan,
} from '../core/steering-state.ts';
import { inSentence, type Look, type OfficeRoom, type Studio } from '../core/studio.ts';
import { capital } from '../core/words.ts';

// ---------------------------------------------------------------------------------------------------------------
// What an operation reads, and what it gives back

/** The office as it stands, for the inverse of an office change. */
export interface OfficeState {
  theme: Theme;
  /** The office's own rooms (not the departments). */
  rooms: OfficeRoom[];
  decor: string[];
  /** Each room's own theme, departments and office rooms alike; null where it follows the office. */
  roomThemes: Record<string, Theme | null>;
  looks: Record<string, Look>;
}

/** The company as a steering operation sees it: its state now, its people and the makers it shares. */
export interface SteerCtx {
  readonly state: CompanyState;
  readonly steering: SteeringState;
  readonly people: readonly Person[];
  /** People who were let go, so a sentence can still name them. */
  readonly fired: readonly Pick<Person, 'id' | 'name' | 'title'>[];
  /** The rooms people sit in (the studio's departments), by id with their names. */
  readonly rooms: readonly { id: string; name: string }[];
  readonly now: number;
  /** The company's next id of a kind: its own ("t-4", "q-2") and steering's ("d-7", "c-1"). */
  newId(kind: IdKind | SteeringIdKind): string;
  /** The company's message maker: its next id and clock; a message to the stakeholder counts as delivered at once. */
  newMessage(from: string, to: string, text: string, extra?: { interrupt?: boolean; cites?: string[]; fromOffice?: boolean }): Message;
  /** A person's desk as the switchboard has it now. */
  deskState(person: string): DeskState;
  /** The model a person runs on now, from their agent file. */
  modelOf(person: string): string;
  /** The office as studio.yaml has it now. */
  office(): OfficeState;
}

/** Every event a step commits: the company's own, steering's among them. */
export type SteerEvent = CompanyEvent;

/** What the company carries out after committing a step: nothing here touches a desk, a file or git itself. */
export type SteerEffect =
  /** Hand a stored message to the switchboard as its person's turn; held turns (paused, gated, over) stay in the company. */
  | { kind: 'deliver'; message: string; cwd?: string }
  /** Interrupt the person's turn and give them this message as their next. */
  | { kind: 'stop'; message: string }
  /** Take back turns still waiting for a desk; with `unsend`, those taken back go (their task is over for that person). */
  | { kind: 'take-back'; messages: string[]; unsend: boolean }
  /** Take back turns still waiting for a desk and hand them out again, so their new priority counts. */
  | { kind: 'redeliver'; messages: string[] }
  /** Save a cancelled task's work on a branch (git, in the background), then report with board.ts `saved`. */
  | { kind: 'save'; save: string }
  /** Make a reopened task's worktree again (git, in the background), then deliver the message there. */
  | { kind: 'reopen-worktree'; task: string; message: string }
  /** The company's own settings, through its settings path: desks at once, idle time, Always allow rules; `by` for the Timeline. */
  | { kind: 'company-settings'; by: string; change: { maxDesks?: number; idleMs?: number; removeRule?: string; addRule?: string } }
  /** A person's model, through the reshape path; it applies at their next desk. */
  | { kind: 'model'; person: string; model: string };

/** One line of the log and what follows it. */
export interface Step {
  events: SteerEvent[];
  effects: SteerEffect[];
}

/** What an operation did: steps to commit in order, and its answer. */
export interface Outcome<T> {
  steps: Step[];
  result: T;
}

export const step = (events: SteerEvent[], effects: SteerEffect[] = []): Step => ({ events, effects });
export const nothing = <T>(result: T): Outcome<T> => ({ steps: [], result });

/** The company's state and steering's, as one operation leaves them. */
export interface World {
  state: CompanyState;
  steering: SteeringState;
}

/** Folds events into a world through the company's own fold, which folds steering's too. */
export function applyEvents(w: World, events: readonly SteerEvent[]): World {
  let state: CompanyState = { ...w.state, steering: w.steering };
  for (const e of events) state = fold(state, e);
  return { state, steering: state.steering };
}

/** The world after an operation's steps. */
export const after = (ctx: Pick<SteerCtx, 'state' | 'steering'>, steps: readonly Step[]): World =>
  applyEvents({ state: ctx.state, steering: ctx.steering }, steps.flatMap((s) => s.events));

// ---------------------------------------------------------------------------------------------------------------
// Words

const stripControls = (text: string): string => text.replace(/(?![\n\t])\p{Cc}/gu, '');
/** Text from a person or the stakeholder as the company keeps it: no control characters, secrets masked, capped. */
export const cleanBlock = (value: unknown, max: number): string =>
  typeof value === 'string' ? redactClip(stripControls(value.replace(/\r\n?/g, '\n')).trim(), max) : '';
export const cleanLine = (value: unknown, max: number): string =>
  typeof value === 'string' ? redactClip(stripControls(value).replace(/\s+/g, ' ').trim(), max) : '';
/** The length of text as it would be kept, before any cut, so an overlong one can be refused rather than cut. */
export const rawLength = (value: unknown): number => (typeof value === 'string' ? stripControls(value).trim().length : 0);

/** "14:05", on the hub's clock. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** “Write the DE copy”. */
export const titled = (title: string): string => `“${oneLine(title, 80)}”`;
/** A sentence without its full stop, to go inside another. */
export const unstopped = (text: string): string => text.replace(/[.\s]+$/, '');

const nameOfPerson = (p: Pick<Person, 'name' | 'title'>): string => (p.name === p.title ? `the ${inSentence(p.title)}` : p.name);

export const bossName = (ctx: Pick<SteerCtx, 'state'>): string => ctx.state.stakeholder || 'the stakeholder';

/** Someone inside a sentence to a person: "Kai", "the QA engineer", "Robin", "the office". */
export function called(ctx: Pick<SteerCtx, 'state' | 'people' | 'fired'>, id: string): string {
  if (id === STAKEHOLDER) return bossName(ctx);
  if (id === THE_OFFICE) return 'the office';
  const p = personById(ctx.people, id) ?? ctx.fired.find((f) => f.id === id);
  return p ? nameOfPerson(p) : id;
}

/** Someone inside a sentence of the decision log, which the stakeholder reads: "you" for them. */
export const inLog = (ctx: Pick<SteerCtx, 'state' | 'people' | 'fired'>, id: string): string => (id === STAKEHOLDER ? 'you' : called(ctx, id));

/** Who decided, at the start of a sentence of the log: "You", "The CEO", "The office", "Ada". */
export function actor(ctx: Pick<SteerCtx, 'state' | 'people' | 'fired'>, id: string): string {
  if (id === STAKEHOLDER) return 'You';
  if (personById(ctx.people, id)?.level === 'ceo') return 'The CEO';
  return capital(called(ctx, id));
}

export const roomOf = (ctx: Pick<SteerCtx, 'people'>, id: string): string | null => personById(ctx.people, id)?.room ?? null;
export const roomTitle = (ctx: Pick<SteerCtx, 'rooms'>, id: string): string => ctx.rooms.find((r) => r.id === id)?.name ?? id;

/** A member of the company, or a refusal naming who isn't. */
export function member(ctx: Pick<SteerCtx, 'people'>, id: unknown): Person {
  const p = typeof id === 'string' ? personById(ctx.people, id) : undefined;
  if (!p) throw new OrgRefusal('unknown', `There's nobody called "${oneLine(String(id), 64)}" in the company.`);
  return p;
}

export const ceoOf = (ctx: Pick<SteerCtx, 'people'>): Person | undefined => ctx.people.find((p) => p.level === 'ceo');

// ---------------------------------------------------------------------------------------------------------------
// Acting on the stakeholder's word

/** A refusal for anything but a list of message ids. */
function citeList(cites: unknown): string[] {
  if (cites === undefined || cites === null) return [];
  if (!Array.isArray(cites) || cites.some((c) => typeof c !== 'string')) throw new OrgRefusal('invalid', 'Cite messages by their ids, like ["m-12"].');
  return [...new Set(cites.map((c: string) => c.trim()).filter(Boolean))].slice(0, 10);
}

/**
 * A note the office wrote in the stakeholder's name: marked so, or the answer to a question, which logs written before
 * the mark existed carry without it.
 */
const officeNote = (m: Message): boolean => m.fromOffice === true || (m.answers !== undefined && m.answers !== null);

/**
 * Words the stakeholder typed into a box in the office. Fail closed: only a message marked typed counts, so a button's
 * words, a plain Stop, the office's notes and messages from logs written before the mark never do.
 */
const typedByStakeholder = (m: Message): boolean => m.from === STAKEHOLDER && m.typed === true && !officeNote(m);

/** The cited messages that check out, for a record that only lists them: what the stakeholder typed to `to`. */
export function stakeholderCites(ctx: Pick<SteerCtx, 'state'>, to: string, cites: unknown): string[] {
  let ids: string[];
  try {
    ids = citeList(cites);
  } catch {
    return [];
  }
  return ids.filter((id) => ctx.state.messages.some((m) => m.id === id && m.to === to && typedByStakeholder(m)));
}

/**
 * The stakeholder's word that someone acts on: the newest of the cited messages, each one the stakeholder typed to
 * `by` and newer than `since` (the last change of what it changes, which `what` names). Refuses with a sentence that
 * says what is wrong and what to cite instead.
 */
export function stakeholderWord(ctx: Pick<SteerCtx, 'state' | 'people' | 'fired'>, by: string, cites: unknown, since: number, what: string): Message {
  const boss = bossName(ctx);
  const who = actor(ctx, by);
  const ids = citeList(cites);
  if (ids.length === 0) throw new OrgRefusal('not-allowed', `${who} acts for ${boss} only on ${boss}'s word: cite the message where ${boss} asked for this (${what}).`);
  const found: Message[] = [];
  for (const id of ids) {
    const m = ctx.state.messages.find((x) => x.id === id);
    if (!m) throw new OrgRefusal('not-allowed', `There's no message ${oneLine(id, 40)}; cite the message where ${boss} asked for this.`);
    if (m.from !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Message ${m.id} is from ${called(ctx, m.from)}, not ${boss}; cite ${boss}'s own message.`);
    if (m.to !== by) throw new OrgRefusal('not-allowed', `Message ${m.id} went to ${called(ctx, m.to)}; cite a message ${boss} sent ${called(ctx, by)}.`);
    if (officeNote(m)) {
      throw new OrgRefusal('not-allowed', `Message ${m.id} is the office's note in ${boss}'s name (an answer, a comment or a request it passed on), not something ${boss} typed to ${called(ctx, by)}; cite ${boss}'s own message.`);
    }
    if (!typedByStakeholder(m)) {
      throw new OrgRefusal(
        'not-allowed',
        `Message ${m.id} holds words the office sent in ${boss}'s name (a button's words, a plain Stop, or a message from before typed words were marked), not something ${boss} typed to ${called(ctx, by)}; cite a message ${boss} typed.`,
      );
    }
    found.push(m);
  }
  const word = found.reduce((a, b) => (b.at > a.at ? b : a));
  if (word.at <= since) {
    throw new OrgRefusal('not-allowed', `Message ${word.id} is older than the last change to ${what} (at ${clock(since)}); cite what ${boss} said since.`);
  }
  return word;
}

// ---------------------------------------------------------------------------------------------------------------
// Recording decisions

export interface DecisionInput {
  by: string;
  kind: DecisionKind;
  what: string;
  why?: string | null;
  alternatives?: readonly string[];
  /** Everyone else it concerns; the decider goes first on their own. */
  people?: readonly (string | null | undefined)[];
  rooms?: readonly (string | null | undefined)[];
  links?: DecisionLinks;
  /** What it changes, so a later change of the same thing supersedes it (see UndoPlan). */
  key?: string | null;
  undo?: UndoPlan | null;
}

const present = (list: readonly (string | null | undefined)[]): string[] => [...new Set(list.filter((x): x is string => typeof x === 'string' && x !== ''))];

/** A decision, and the event that puts it in the log. */
export function decided(ctx: Pick<SteerCtx, 'now' | 'newId'>, d: DecisionInput): { decision: Decision; event: SteeringEvent } {
  const decision: Decision = {
    id: ctx.newId('decision'),
    at: ctx.now,
    by: d.by,
    kind: d.kind,
    what: oneLine(redactClip(d.what, DECISION_LIMITS.what), DECISION_LIMITS.what),
    why: d.why ? redactClip(d.why, DECISION_LIMITS.why) : null,
    alternatives: (d.alternatives ?? []).slice(0, DECISION_LIMITS.alternatives).map((a) => oneLine(redactClip(a, DECISION_LIMITS.alternative), DECISION_LIMITS.alternative)),
    people: present([d.by, ...(d.people ?? [])]),
    rooms: present(d.rooms ?? []),
    links: { ...(d.links ?? {}) },
    reversible: d.undo !== undefined && d.undo !== null,
    undone: null,
    reconsider: null,
  };
  return { decision, event: { type: 'decision-recorded', decision, key: d.key ?? d.undo?.key ?? null, undo: d.undo ?? null } };
}

/** The decide tool: what a person decided, why and what else they weighed, citing the messages it follows. */
export function recordDecision(ctx: SteerCtx, by: string, input: { what: unknown; why: unknown; alternatives: unknown; cites: unknown }): Outcome<Decision> {
  if (by === STAKEHOLDER || by === THE_OFFICE) {
    throw new OrgRefusal('not-allowed', 'The decide tool is for people in the company; your own choices land in the log as you make them.');
  }
  const person = member(ctx, by);
  const what = cleanLine(input.what, DECISION_LIMITS.what);
  if (!what) throw new OrgRefusal('invalid', 'Say what you decided, in one sentence.');
  if (rawLength(input.what) > DECISION_LIMITS.what) throw new OrgRefusal('invalid', `Say what you decided in up to ${DECISION_LIMITS.what} characters; the why can say more.`);
  if (rawLength(input.why) > DECISION_LIMITS.why) throw new OrgRefusal('invalid', `Keep the why to ${DECISION_LIMITS.why} characters.`);
  const why = cleanBlock(input.why, DECISION_LIMITS.why) || null;
  const raw = input.alternatives === undefined || input.alternatives === null ? [] : input.alternatives;
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== 'string')) throw new OrgRefusal('invalid', 'List the alternatives as sentences.');
  if (raw.length > DECISION_LIMITS.alternatives) throw new OrgRefusal('invalid', `Name up to ${DECISION_LIMITS.alternatives} alternatives: the ones you weighed most.`);
  const alternatives = raw.map((a: string) => cleanLine(a, DECISION_LIMITS.alternative)).filter(Boolean);
  const cites = citeList(input.cites);
  for (const id of cites) {
    const m = ctx.state.messages.find((x) => x.id === id);
    if (!m || m.to !== by) throw new OrgRefusal('not-allowed', `You can cite only messages you received, and ${oneLine(id, 40)} isn't one of yours.`);
  }
  // The trace follows the stakeholder's messages, so a cite of theirs (or of one passed on from them) is the one linked.
  const fromBoss = cites.find((id) => ctx.state.messages.some((m) => m.id === id && (m.from === STAKEHOLDER || m.origin === STAKEHOLDER)));
  const message = fromBoss ?? cites[0];
  const task = [...ctx.state.tasks].reverse().find((t) => t.owner === by && t.status === 'working');
  const manager = person.reportsTo;
  const { decision, event } = decided(ctx, {
    by,
    kind: 'decide',
    what,
    why,
    alternatives,
    people: [manager],
    rooms: [person.room],
    links: { ...(message ? { message } : {}), ...(task ? { task: task.id } : {}) },
  });
  return { steps: [step([event])], result: decision };
}

/** The stakeholder's answer to a question, once it took effect (applied); gate questions are answers too. */
export function answerDecision(ctx: SteerCtx, q: Question): SteerEvent[] {
  if (!q.answer) return [];
  const option = q.answer.option === null ? '' : unstopped(q.options[q.answer.option] ?? '');
  const words = [option, unstopped(q.answer.text)].filter(Boolean).join(': ');
  const asker = q.from === THE_OFFICE ? null : q.from;
  const gateTask = q.gate ? ctx.state.tasks.find((t) => t.id === q.gate?.task) : undefined;
  // v0.2: nobody answered in time and the asker's pick stood: the office decided, in the stakeholder's absence.
  const byDefault = q.answer.byDefault === true;
  const what = gateTask
    ? q.answer.option === 0
      ? `You let ${called(ctx, gateTask.owner)} start ${titled(gateTask.title)}.`
      : `You held ${titled(gateTask.title)} back from ${called(ctx, gateTask.owner)}${words ? `: ${words}` : ''}.`
    : byDefault
      ? `Nobody answered ${asker ? called(ctx, asker) : 'the office'} in time, so the pick stood${words ? `: ${words}` : ''}.`
      : `You answered ${asker ? called(ctx, asker) : 'the office'}${words ? `: ${words}` : ''}.`;
  const owner = gateTask?.owner ?? asker;
  const taskId = gateTask?.id ?? q.taskId;
  return [
    decided(ctx, {
      by: byDefault ? THE_OFFICE : STAKEHOLDER,
      kind: 'answer',
      what,
      people: [owner],
      rooms: [owner ? roomOf(ctx, owner) : null],
      links: { question: q.id, ...(taskId ? { task: taskId } : {}) },
    }).event,
  ];
}

/** The stakeholder's answer to an approval, once it took effect. "Always allow" makes a rule, which Undo can remove. */
export function approvalDecision(ctx: SteerCtx, a: Approval): SteerEvent[] {
  if (!a.answer) return [];
  const who = called(ctx, a.person);
  const what = unstopped(a.summary).replace(/^\p{Lu}/u, (c) => c.toLowerCase());
  const rule = a.answer.decision === 'allow' && a.answer.always ? a.alwaysRule?.rule : undefined;
  const room = roomOf(ctx, a.person);
  if (rule) {
    return [
      decided(ctx, {
        by: STAKEHOLDER,
        kind: 'rule',
        what: `You always allowed ${who} to ${what}: ${rule}.`,
        people: [a.person],
        rooms: [room],
        links: { approval: a.id },
        key: `rule:${rule}`,
        undo: { kind: 'settings', key: `rule:${rule}`, change: { removeRule: rule } },
      }).event,
    ];
  }
  const verb = a.answer.decision === 'allow' ? `You allowed ${who} to ${what}, once.` : `You didn't allow ${who} to ${what}.`;
  return [decided(ctx, { by: STAKEHOLDER, kind: 'approval', what: verb, why: a.answer.note, people: [a.person], rooms: [room], links: { approval: a.id } }).event];
}

// ---------------------------------------------------------------------------------------------------------------
// The org and the office

/** What a change to the org was, with what the company knew before it (for the inverse). */
export type OrgChange =
  | { action: 'hire'; role: string }
  | { action: 'fire'; role: string }
  | { action: 'rehire'; role: string }
  | { action: 'move'; role: string; before: { room: string; reportsTo: string | null } };

/**
 * The decision for a change to the org, recorded by the company after the org flow made it. `ctx` is the company after
 * the change; `words` is the sentence the company already wrote for the Timeline.
 */
export function orgDecision(ctx: SteerCtx, by: string, change: OrgChange, words: string, cites: readonly string[] = []): SteerEvent[] {
  const key = `org:${change.role}`;
  const undo: UndoPlan =
    change.action === 'hire' || change.action === 'rehire'
      ? { kind: 'org', key, change: { action: 'fire', role: change.role } }
      : change.action === 'fire'
        ? { kind: 'org', key, change: { action: 'rehire', role: change.role } }
        : { kind: 'org', key, change: { action: 'move', role: change.role, room: change.before.room, reportsTo: change.before.reportsTo } };
  const p = personById(ctx.people, change.role);
  const manager = p?.reportsTo ?? (change.action === 'move' ? change.before.reportsTo : null);
  return [
    decided(ctx, {
      by,
      kind: 'org',
      what: words,
      people: [change.role, manager],
      rooms: [p?.room ?? null, change.action === 'move' ? change.before.room : null],
      links: cites[0] ? { message: cites[0] } : {},
      key,
      undo,
    }).event,
  ];
}

/** The office's state from studio.yaml. */
export function officeStateOf(studio: Studio | null): OfficeState {
  const roomThemes: Record<string, Theme | null> = Object.create(null) as Record<string, Theme | null>;
  const looks: Record<string, Look> = Object.create(null) as Record<string, Look>;
  for (const d of studio?.departments ?? []) roomThemes[d.id] = d.theme ?? null;
  for (const r of studio?.office?.rooms ?? []) roomThemes[r.id] = r.theme ?? null;
  for (const r of studio?.roles ?? []) looks[r.id] = { ...(r.look ?? {}) };
  return {
    theme: studio?.office?.theme ?? 'office',
    rooms: (studio?.office?.rooms ?? []).map((r) => ({ ...r })),
    decor: [...(studio?.office?.decor ?? [])],
    roomThemes,
    looks,
  };
}

/** The change that takes an office change back, given the office before it; null when it changed nothing. */
export function officeInverse(change: OfficeChange, before: OfficeState): OfficeChange | null {
  switch (change.change) {
    case 'theme':
      return change.theme === before.theme ? null : { change: 'theme', theme: before.theme };
    case 'add-room':
      return before.rooms.some((r) => r.id === change.room.id) ? null : { change: 'remove-room', room: change.room.id };
    case 'remove-room': {
      const room = before.rooms.find((r) => r.id === change.room);
      return room ? { change: 'add-room', room: { ...room } } : null;
    }
    case 'room-theme': {
      const was = Object.hasOwn(before.roomThemes, change.room) ? (before.roomThemes[change.room] ?? null) : null;
      return was === change.theme ? null : { change: 'room-theme', room: change.room, theme: was };
    }
    case 'decor': {
      const add = change.remove.filter((d) => before.decor.includes(d));
      const remove = change.add.filter((d) => !before.decor.includes(d));
      return add.length === 0 && remove.length === 0 ? null : { change: 'decor', add, remove };
    }
    case 'look': {
      const was = Object.hasOwn(before.looks, change.person) ? before.looks[change.person] : undefined;
      return { change: 'look', person: change.person, look: { ...(was ?? {}) } };
    }
    default:
      return null;
  }
}

const officeKey = (change: OfficeChange): string => {
  switch (change.change) {
    case 'theme':
      return 'office:theme';
    case 'add-room':
      return `office:room:${change.room.id}`;
    case 'remove-room':
      return `office:room:${change.room}`;
    case 'room-theme':
      return `office:room-theme:${change.room}`;
    case 'decor':
      return 'office:decor';
    case 'look':
      return `office:look:${change.person}`;
    default:
      return 'office';
  }
};

/** The decision for an office change, given the office before it and the Timeline's sentence. */
export function officeDecision(ctx: SteerCtx, by: string, change: OfficeChange, before: OfficeState, words: string, cites: readonly string[] = []): SteerEvent[] {
  const inverse = officeInverse(change, before);
  const key = officeKey(change);
  const room = change.change === 'room-theme' ? change.room : change.change === 'add-room' ? change.room.id : change.change === 'remove-room' ? change.room : null;
  return [
    decided(ctx, {
      by,
      kind: 'office',
      what: words,
      people: change.change === 'look' ? [change.person] : [],
      rooms: [room ?? roomOf(ctx, by)],
      links: cites[0] ? { message: cites[0] } : {},
      key,
      undo: inverse ? { kind: 'office', key, change: inverse } : null,
    }).event,
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Undo

const EFFORT_WORDS: Record<Effort, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'maximum' };
export const effortWords = (effort: Effort | null): string => (effort === null ? "Claude Code's default" : EFFORT_WORDS[effort]);
const LEASH_WORDS: Record<Leash, string> = { check: 'checking with you before each task', default: "the company's approvals", trusted: 'Trusted' };
export const leashWords = (leash: Leash): string => LEASH_WORDS[leash];
const APPROVAL_WORDS: Record<PlanApproval, string> = { 'before-work': 'before work starts', milestones: 'at every milestone', off: 'off' };
export const approvalWords = (setting: PlanApproval): string => APPROVAL_WORDS[setting];
export const modelWords = (model: string): string => (model === 'inherit' ? 'the same model as the session' : capital(model));

/** Why an undo can't run now, in a sentence; null when it can. */
export function undoPossible(ctx: SteerCtx, plan: UndoPlan): string | null {
  switch (plan.kind) {
    case 'settings': {
      const c = plan.change;
      if (c.removeRule !== undefined && !ctx.state.settings.alwaysAllow.includes(c.removeRule)) return 'That rule is gone already, so there is nothing to undo.';
      if (c.addRule !== undefined && ctx.state.settings.alwaysAllow.includes(c.addRule)) return 'That rule is in force already.';
      const person = c.leash && 'person' in c.leash ? c.leash.person : (c.effort?.person ?? c.model?.person);
      if (person !== undefined && !personById(ctx.people, person)) return `${capital(called(ctx, person))} isn't in the company any more.`;
      return null;
    }
    case 'org': {
      const c = plan.change;
      const here = personById(ctx.people, c.role) !== undefined;
      if (c.action === 'rehire') return here ? `${capital(called(ctx, c.role))} is on staff already.` : ctx.fired.some((f) => f.id === c.role) ? null : `${c.role} can't be rehired: the office has no record of them.`;
      return here ? null : `${capital(called(ctx, c.role))} isn't in the company any more.`;
    }
    case 'office':
      return null;
    case 'plan':
      return ctx.steering.versions.some((v) => v.version === plan.version) ? null : `Version ${plan.version} of the plan isn't kept any more.`;
    case 'reopen': {
      const tasks = plan.tasks.map((id) => ctx.state.tasks.find((t) => t.id === id));
      for (const t of tasks) {
        if (!t) return 'That task is gone from the board.';
        if (t.status !== 'dropped' || !t.cancel) return `${titled(t.title)} isn't cancelled any more.`;
        if (!personById(ctx.people, t.owner)) return `${capital(called(ctx, t.owner))}, who had ${titled(t.title)}, isn't in the company any more.`;
      }
      const mine = new Set(plan.tasks);
      for (const t of tasks) {
        if (!t) continue;
        for (const other of ctx.state.tasks) {
          if (mine.has(other.id) || !isOpenTask(other)) continue;
          const shared = t.files.find((f) => other.files.some((g) => pathsOverlap(f, g)));
          if (shared !== undefined) return `${shared} belongs to ${called(ctx, other.owner)}'s task ${titled(other.title)} now, so ${titled(t.title)} can't open again until that is done.`;
        }
      }
      return null;
    }
    case 'cancel': {
      const open = plan.tasks.map((id) => ctx.state.tasks.find((t) => t.id === id)).filter((t) => t !== undefined && isOpenTask(t));
      return open.length > 0 ? null : 'Those tasks are over already.';
    }
    default:
      return null;
  }
}

/** The plan that would take back applying `plan` now: what Undo does to an undo. Null where nothing would. */
export function inverseNow(ctx: SteerCtx, plan: UndoPlan): UndoPlan | null {
  switch (plan.kind) {
    case 'settings': {
      const c = plan.change;
      const s = ctx.steering.settings;
      const back: SettingsUndo = {};
      if (c.maxDesks !== undefined) back.maxDesks = ctx.state.settings.maxDesks;
      if (c.idleMs !== undefined) back.idleMs = ctx.state.settings.idleMs;
      if (c.planApproval !== undefined) back.planApproval = s.planApproval;
      if (c.leash) {
        back.leash = 'person' in c.leash
          ? { person: c.leash.person, leash: Object.hasOwn(s.leash.people, c.leash.person) ? (s.leash.people[c.leash.person] ?? null) : null }
          : { room: c.leash.room, leash: Object.hasOwn(s.leash.rooms, c.leash.room) ? (s.leash.rooms[c.leash.room] ?? null) : null };
      }
      if (c.effort) back.effort = { person: c.effort.person, effort: Object.hasOwn(s.effort, c.effort.person) ? (s.effort[c.effort.person] ?? null) : null };
      if (c.model) back.model = { person: c.model.person, model: ctx.modelOf(c.model.person) };
      if (c.removeRule !== undefined) back.addRule = c.removeRule;
      if (c.addRule !== undefined) back.removeRule = c.addRule;
      return { kind: 'settings', key: plan.key, change: back };
    }
    case 'org': {
      const c = plan.change;
      if (c.action === 'fire') return { kind: 'org', key: plan.key, change: { action: 'rehire', role: c.role } };
      if (c.action === 'rehire') return { kind: 'org', key: plan.key, change: { action: 'fire', role: c.role } };
      const p = personById(ctx.people, c.role);
      return p ? { kind: 'org', key: plan.key, change: { action: 'move', role: c.role, room: p.room, reportsTo: p.reportsTo } } : null;
    }
    case 'office': {
      const inverse = officeInverse(plan.change, ctx.office());
      return inverse ? { kind: 'office', key: plan.key, change: inverse } : null;
    }
    case 'plan': {
      const latest = ctx.steering.versions.at(-1);
      return latest ? { kind: 'plan', key: plan.key, version: latest.version } : null;
    }
    case 'reopen': {
      const reason = plan.tasks.map((id) => ctx.state.tasks.find((t) => t.id === id)?.cancel?.reason).find((r) => r !== undefined) ?? 'Cancelled again.';
      return { kind: 'cancel', key: plan.key, tasks: [...plan.tasks], reason };
    }
    case 'cancel':
      return { kind: 'reopen', key: plan.key, tasks: [...plan.tasks] };
    default:
      return null;
  }
}

/**
 * How the company carries out each kind of undo. The settings, plan and task kinds come back as steps (from leash.ts,
 * plan.ts and board.ts); org and office changes go through the org flow at once, as the company's own hire, fire,
 * move and changeOffice do, without a decision of their own.
 */
export interface UndoOps {
  settings(change: SettingsUndo): Step[];
  plan(version: number, undid: Decision): Step[];
  reopen(tasks: readonly string[], undid: Decision): Step[];
  cancel(tasks: readonly string[], reason: string): Step[];
  org(change: UndoPlan & { kind: 'org' }): ReshapeResult;
  office(change: OfficeChange): ReshapeResult;
}

/** What the undo left, in a clause for its sentence. */
function undoneWords(ctx: SteerCtx, plan: UndoPlan): string {
  switch (plan.kind) {
    case 'settings': {
      const c = plan.change;
      const parts: string[] = [];
      if (c.maxDesks !== undefined) parts.push(`${c.maxDesks} desk${c.maxDesks === 1 ? '' : 's'} at once again`);
      if (c.idleMs !== undefined) parts.push(`idle desks close after ${Math.round(c.idleMs / 60_000)} min again`);
      if (c.planApproval !== undefined) parts.push(`plan approval is ${approvalWords(c.planApproval)} again`);
      if (c.leash) {
        const person = 'person' in c.leash;
        const target = 'person' in c.leash ? capital(called(ctx, c.leash.person)) : `the ${roomTitle(ctx, c.leash.room)} room`;
        parts.push(c.leash.leash === null ? `${target} has no leash of ${person ? 'their' : 'its'} own again` : `${target} is on ${leashWords(c.leash.leash)} again`);
      }
      if (c.effort) parts.push(`${capital(called(ctx, c.effort.person))}'s effort is ${effortWords(c.effort.effort)} again`);
      if (c.model) parts.push(`${capital(called(ctx, c.model.person))} runs on ${modelWords(c.model.model)} again`);
      if (c.removeRule !== undefined) parts.push(`${c.removeRule} is asked again`);
      if (c.addRule !== undefined) parts.push(`${c.addRule} is allowed again`);
      return andList(parts);
    }
    case 'org':
      return plan.change.action === 'fire'
        ? `${capital(called(ctx, plan.change.role))} is let go again`
        : plan.change.action === 'rehire'
          ? `${capital(called(ctx, plan.change.role))} is back`
          : `${capital(called(ctx, plan.change.role))} is back in ${roomTitle(ctx, plan.change.room)}`;
    case 'office':
      return 'the office is as it was';
    case 'plan':
      return `the plan of version ${plan.version} is back, as a new version`;
    case 'reopen':
      return plan.tasks.length === 1 ? 'the task is open again' : `${plan.tasks.length} tasks are open again`;
    case 'cancel':
      return plan.tasks.length === 1 ? 'the task is cancelled again' : `${plan.tasks.length} tasks are cancelled again`;
    default:
      return 'it is as it was';
  }
}

/**
 * Takes a decision back: checks it can be (only the stakeholder, from the log; only the newest change of a thing;
 * only while what it needs still holds), carries out its inverse through `ops`, and records the undo as a decision of
 * its own that Undo can take back in turn while nothing changes the same thing.
 */
export function undoDecision(ctx: SteerCtx, ops: UndoOps, by: string, id: string): Outcome<Decision> {
  if (by !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Only ${bossName(ctx)} undoes decisions, from the log.`);
  const d = ctx.steering.decisions.find((x) => x.id === id);
  if (!d) throw new OrgRefusal('unknown', `There's no decision ${oneLine(String(id), 40)} in the log.`);
  const plan = Object.hasOwn(ctx.steering.undos, d.id) ? ctx.steering.undos[d.id] : undefined;
  if (d.undone) throw new OrgRefusal('conflict', 'That decision was undone already.');
  if (!plan) throw new OrgRefusal('conflict', "That decision can't be undone; send it back with Reconsider, or decide again.");
  if (!reversibleIn(ctx.steering, d)) throw new OrgRefusal('conflict', 'Something later changed the same thing, so this one can only be undone after that.');
  const why = undoPossible(ctx, plan);
  if (why) throw new OrgRefusal('conflict', why);
  const redo = inverseNow(ctx, plan);
  let steps: Step[] = [];
  let links: DecisionLinks = { decision: d.id };
  switch (plan.kind) {
    case 'settings':
      steps = ops.settings(plan.change);
      break;
    case 'org': {
      const result = ops.org(plan);
      if (!result.ok) throw new OrgRefusal('conflict', result.message);
      break;
    }
    case 'office': {
      const result = ops.office(plan.change);
      if (!result.ok) throw new OrgRefusal('conflict', result.message);
      break;
    }
    case 'plan': {
      steps = ops.plan(plan.version, d);
      const made = steps.flatMap((s) => s.events).find((e): e is SteeringEvent & { type: 'plan-version' } => e.type === 'plan-version');
      if (made) links = { ...links, planVersion: made.version.version };
      break;
    }
    case 'reopen':
      steps = ops.reopen(plan.tasks, d);
      links = { ...links, ...(plan.tasks[0] ? { task: plan.tasks[0] } : {}) };
      break;
    case 'cancel':
      steps = ops.cancel(plan.tasks, plan.reason);
      links = { ...links, ...(plan.tasks[0] ? { task: plan.tasks[0] } : {}) };
      break;
  }
  const { decision, event } = decided(ctx, {
    by,
    kind: 'undo',
    what: `You undid ${titled(unstopped(d.what))}: ${undoneWords(ctx, plan)}.`,
    people: d.people,
    rooms: d.rooms,
    links,
    key: plan.key,
    undo: redo,
  });
  const undone: SteeringEvent = { type: 'decision-undone', id: d.id, undone: { at: ctx.now, by, decision: decision.id } };
  return { steps: [...steps, step([event, undone])], result: decision };
}

// ---------------------------------------------------------------------------------------------------------------
// Reconsider

/** Sends a decision back to whoever made it, with the stakeholder's note, as a message that cites it. */
export function reconsider(ctx: SteerCtx, by: string, input: { decision: unknown; note: unknown }): Outcome<Message> {
  if (by !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Only ${bossName(ctx)} sends decisions back to be reconsidered.`);
  const d = ctx.steering.decisions.find((x) => x.id === input.decision);
  if (!d) throw new OrgRefusal('unknown', `There's no decision ${oneLine(String(input.decision), 40)} in the log.`);
  if (d.by === STAKEHOLDER) throw new OrgRefusal('invalid', 'You made that decision yourself; undo it, or decide again.');
  const decider = personById(ctx.people, d.by);
  if (!decider) {
    throw new OrgRefusal('closed', d.by === THE_OFFICE ? 'The office made that one on its own rules; change the setting behind it instead.' : `${capital(called(ctx, d.by))} isn't in the company any more.`);
  }
  if (rawLength(input.note) > DECISION_LIMITS.note) throw new OrgRefusal('invalid', `Keep the note to ${DECISION_LIMITS.note} characters.`);
  const note = cleanBlock(input.note, DECISION_LIMITS.note);
  if (!note) throw new OrgRefusal('invalid', 'Say what to look at again, so they know what to reconsider.');
  // The note is capped well under a message's limit, so the whole text always fits.
  const text = `Please reconsider your decision ${d.id}: ${titled(unstopped(d.what))}\n${note}`;
  const m = ctx.newMessage(STAKEHOLDER, decider.id, text.slice(0, LIMITS.message), { cites: [d.id], fromOffice: true });
  const { event } = decided(ctx, {
    by,
    kind: 'reconsider',
    what: `You asked ${called(ctx, decider.id)} to reconsider ${titled(unstopped(d.what))}.`,
    why: note,
    people: [decider.id],
    rooms: [decider.room],
    links: { decision: d.id, message: m.id },
  });
  const marked: SteeringEvent = { type: 'decision-reconsidered', id: d.id, reconsider: { at: ctx.now, note, message: m.id } };
  return { steps: [step([{ type: 'message', message: m }, event, marked], [{ kind: 'deliver', message: m.id }])], result: m };
}
