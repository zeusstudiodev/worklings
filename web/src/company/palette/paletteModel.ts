// The command palette (SPEC-v3.md "Steering", "Also"): every action the office can take, found by typing words, with
// the arguments it still needs asked one at a time; recent actions first; the shortcut that opens it. Pure, so it can
// be tested; Palette only draws it and runs what is picked.
import { type CompanyView, LIMITS, STAKEHOLDER, type Task } from '../../../../src/core/company.ts';
import { clip, countWord, plainText } from '../../../../src/core/now.ts';
import { isPlainPerson } from '../../../../src/core/plain.ts';
import type { CatalogRole, ReshapeAction, Snapshot } from '../../../../src/core/snapshot.ts';
import { type Decision, type Effort, type Leash, type NewTaskInput, PLAN_LIMITS, type Recipient, type SettingsChange } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { recipientChoices, roomTitle } from '../compose/recipients.ts';
import { personLabel } from '../dashboards/boardsModel.ts';
import { DEFAULT_EFFORT, EFFORT_WORDS, effortChoices, LEASH_WORDS, leashChoices, modelChoices, personDraft, roomChoices, roomLeash, steeringOf } from '../leash/leashModel.ts';
import { called, flatten, nameOf, orgOutline, roomName } from '../people/peopleModel.ts';
import { canStop, modelName, STOP_AND_WAIT } from '../person/personModel.ts';
import { approveChoices, doneMilestones } from '../plan/planModel.ts';
import { decisionPath, planPath, tracePath } from '../trace/traceModel.ts';
import type { SendOptions } from '../types.ts';

// ---------------------------------------------------------------------------------------------------------------
// Commands

export type PaletteAction =
  | { kind: 'open'; path: string }
  | { kind: 'message'; to: Recipient }
  | { kind: 'stop'; person: string }
  | { kind: 'pause-company' }
  | { kind: 'resume-company' }
  | { kind: 'pause-room'; room: string }
  | { kind: 'resume-room'; room: string }
  | { kind: 'approve-plan'; version: number; through: string | null }
  | { kind: 'pause-task'; task: string }
  | { kind: 'resume-task'; task: string }
  | { kind: 'cancel-task'; task: string }
  | { kind: 'reassign-task'; task: string }
  | { kind: 'create-task' }
  | { kind: 'leash'; person: string }
  | { kind: 'room-leash'; room: string }
  | { kind: 'model'; person: string }
  | { kind: 'effort'; person: string }
  | { kind: 'undo-decision'; decision: string }
  /**
   * Hire into a room (the org chart's). With the library, its role is picked and the hire reports to the room's head, or
   * to the CEO when the room has none (`managers` by room); without it, the CEO is asked to hire.
   */
  | { kind: 'hire'; managers: [room: string, manager: string][]; rooms: [room: string, name: string][]; ceo: string | null; library: boolean }
  | { kind: 'fire'; person: string }
  | { kind: 'move'; person: string }
  | { kind: 'rehire'; role: string }
  /** Opens the feed over the talk bar; `catchUp` asks for v2's digest too. */
  | { kind: 'feed'; catchUp: boolean };

export interface PaletteOption {
  value: string;
  label: string;
  hint: string | null;
}

/** What a command still asks for: words, or one of a few choices. */
export type PaletteStep =
  | { kind: 'text'; key: string; label: string; optional: boolean; max: number; long: boolean; hint: string | null }
  | { kind: 'choice'; key: string; label: string; options: PaletteOption[] };

export const SECTIONS = ['Message', 'Work', 'Plan', 'Tasks', 'People', 'Decisions', 'Go to'] as const;
export type PaletteSection = (typeof SECTIONS)[number];

export interface PaletteCommand {
  /** Stable across snapshots, so a recent one is found again: "message:room:design", "pause-task:t-11". */
  id: string;
  label: string;
  section: PaletteSection;
  /** Words it is found by besides its label: titles, rooms, owners, other words for the verb. */
  words: string;
  /** A second line: who it reaches, what it does, how it stands now. */
  hint: string | null;
  action: PaletteAction;
  steps: PaletteStep[];
  /** It sends something, so it waits while the office is unreachable. */
  sends: boolean;
  /** Offered before anything is typed. */
  suggested: boolean;
}

/** Other words people type for a verb. */
const SYNONYMS = {
  message: 'send tell write say dm',
  stop: 'interrupt halt redirect',
  pause: 'hold freeze',
  resume: 'continue unpause restart go',
  approve: 'accept ok yes start',
  cancel: 'drop kill abandon',
  reassign: 'hand over handover give move',
  create: 'new add make',
  leash: 'trust autonomy check permissions',
  model: 'opus sonnet haiku',
  effort: 'thinking reasoning',
  undo: 'revert take back',
  open: 'go show see view',
  hire: 'recruit add new staff role person',
  fire: 'dismiss let go remove',
  move: 'transfer room switch',
  rehire: 'bring back hire again',
};

type Source = Pick<Snapshot, 'studio'>;
type Company = Pick<CompanyView, 'people' | 'tasks' | 'messages' | 'pause' | 'phase' | 'steering' | 'goal'>;

const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'dropped';
const taskTitle = (t: Task) => `“${clip(plainText(t.title), 60)}”`;
const textStep = (key: string, label: string, max: number, extra: Partial<Extract<PaletteStep, { kind: 'text' }>> = {}): PaletteStep => ({
  kind: 'text',
  key,
  label,
  optional: false,
  max,
  long: false,
  hint: null,
  ...extra,
});

/**
 * Every action the company offers now. Steering's need its routes (`steering`); "Open the feed" needs the talk bar
 * (`feed`) and "Catch me up" a live office that can write the digest (`catchUp`); the rest are v3's own.
 */
export function paletteCommands(
  snapshot: Source,
  company: Company,
  options: { steering: boolean; feed?: boolean; catchUp?: boolean; library?: readonly CatalogRole[] | null },
): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const { steering } = options;
  const people = flatten(orgOutline(snapshot, company)).map((n) => n.person);
  const personOptions = (except: readonly string[] = []): PaletteOption[] =>
    people.filter((p) => !except.includes(p.id)).map((p) => ({ value: p.id, label: personLabel(p), hint: roomName(snapshot, p.room) }));
  const add = (c: Omit<PaletteCommand, 'steps' | 'sends' | 'hint' | 'words' | 'suggested'> & Partial<Pick<PaletteCommand, 'steps' | 'sends' | 'hint' | 'words' | 'suggested'>>) =>
    out.push({ steps: [], sends: true, hint: null, words: '', suggested: false, ...c });

  // Message
  const choices = recipientChoices(snapshot, company);
  const messageStep = (title: string) => textStep('text', `Message to ${title}`, LIMITS.message, { long: true, hint: 'Enter sends. Shift and Enter start a new line.' });
  const reachHint = (reach: readonly string[]) => {
    const names = reach.flatMap((id) => people.filter((p) => p.id === id)).map((p) => p.name);
    return names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${countWord(names.length - 3)} more` : names.join(', ');
  };
  if (steering) {
    const e = choices.everyone;
    add({ id: 'message:everyone', label: 'Message everyone', section: 'Message', words: `all hands ${SYNONYMS.message}`, hint: `${capital(countWord(e.reach.length))} people`, action: { kind: 'message', to: e.recipient }, steps: [messageStep('everyone')], suggested: true });
    for (const c of [...choices.rooms, ...choices.teams]) {
      // A team is found by its head's title and room too: "design team" finds Ada's.
      const r = c.recipient;
      const head = r.kind === 'team' ? people.find((p) => p.id === r.head) : undefined;
      const words = head ? `team ${head.title} ${roomName(snapshot, head.room)} ${SYNONYMS.message}` : `room ${SYNONYMS.message}`;
      add({ id: `message:${c.key}`, label: `Message ${c.title}`, section: 'Message', words, hint: reachHint(c.reach), action: { kind: 'message', to: c.recipient }, steps: [messageStep(c.title)] });
    }
  }
  for (const p of people) {
    add({
      id: `message:person:${p.id}`,
      label: `Message ${personLabel(p)}`,
      section: 'Message',
      words: `${p.title} ${roomName(snapshot, p.room)} ${p.id} ${SYNONYMS.message}`,
      hint: roomName(snapshot, p.room),
      action: { kind: 'message', to: { kind: 'person', id: p.id } },
      steps: [messageStep(called(p))],
      suggested: p.level === 'ceo',
    });
  }

  // Work
  for (const p of people) {
    if (!canStop(p)) continue;
    add({
      id: `stop:${p.id}`,
      label: `Stop ${personLabel(p)}`,
      section: 'Work',
      words: `${p.title} ${SYNONYMS.stop}`,
      hint: 'Interrupts their turn',
      action: { kind: 'stop', person: p.id },
      steps: [textStep('instruction', `What should ${called(p)} do instead?`, LIMITS.message, { optional: true, long: true, hint: 'Leave it empty to have them stop and wait for your next message.' })],
    });
  }
  const pausedByYou = company.pause?.reason === 'stakeholder';
  if (company.phase === 'running' && !pausedByYou) add({ id: 'pause-company', label: 'Pause work', section: 'Work', words: `company everyone ${SYNONYMS.pause}`, hint: 'Everyone stops after their current step', action: { kind: 'pause-company' }, suggested: true });
  if (pausedByYou || company.phase === 'stopped') add({ id: 'resume-company', label: 'Resume work', section: 'Work', words: `company everyone ${SYNONYMS.resume}`, hint: null, action: { kind: 'resume-company' }, suggested: true });
  // Paused for its budget: Settings, where the budget is raised (More's "Raise the budget" opens the same).
  if (company.pause?.reason === 'budget') add({ id: 'raise-budget', label: 'Raise the budget', section: 'Work', words: 'budget money spend limit cap more resume', hint: 'Opens Settings, where the budget is', action: { kind: 'open', path: 'settings' }, sends: false, suggested: true });
  if (steering) {
    for (const room of [...new Set(people.map((p) => p.room))]) {
      const inRoom = new Set(people.filter((p) => p.room === room).map((p) => p.id));
      const open = company.tasks.filter((t) => isOpen(t) && inRoom.has(t.owner));
      const running = open.filter((t) => !t.paused).length;
      const held = open.length - running;
      const title = roomTitle(snapshot, room);
      const tasks = (n: number) => `${capital(countWord(n))} open ${n === 1 ? 'task' : 'tasks'}`;
      if (running > 0) add({ id: `pause-room:${room}`, label: `Pause ${title}`, section: 'Work', words: SYNONYMS.pause, hint: tasks(running), action: { kind: 'pause-room', room } });
      if (held > 0) add({ id: `resume-room:${room}`, label: `Resume ${title}`, section: 'Work', words: SYNONYMS.resume, hint: `${capital(countWord(held))} paused`, action: { kind: 'resume-room', room } });
    }
  }

  // The plan
  const plan = company.steering?.plan ?? null;
  const latest = plan?.versions.at(-1) ?? null;
  if (steering && plan && latest) {
    // The same choices as the plan page's Approve buttons: its primary one, suggested, and the others as the page lists them.
    const choices = approveChoices(plan, company.steering?.settings.planApproval ?? null, doneMilestones(company, latest.plan));
    if (choices) {
      const more = [choices.primary, ...choices.more];
      more.forEach((c, i) => {
        add({
          id: c.through === null ? 'approve-plan' : `approve-plan:through:${c.through}`,
          label: c.label,
          section: 'Plan',
          words: `plan ${c.through === null ? '' : 'milestone '}${SYNONYMS.approve}`,
          // By what the choice approves, not where it sits: the whole plan is last among the milestones' choices.
          hint: c.through === null ? 'Work starts on its tasks' : 'The milestones after it wait for you',
          action: { kind: 'approve-plan', version: choices.version, through: c.through },
          suggested: i === 0,
        });
      });
    }
    add({ id: 'open:plan', label: 'Open the plan', section: 'Plan', words: `plan versions ${SYNONYMS.open}`, hint: `Version ${latest.version}`, action: { kind: 'open', path: planPath(latest.version) }, sends: false });
  }

  // Tasks
  if (steering) {
    add({
      id: 'create-task',
      label: 'Create a task',
      section: 'Tasks',
      words: `task ${SYNONYMS.create}`,
      hint: 'It reaches its owner in priority order, and their head is told',
      action: { kind: 'create-task' },
      suggested: true,
      steps: [
        textStep('title', 'Title of the task', PLAN_LIMITS.title),
        { kind: 'choice', key: 'owner', label: 'Who owns it?', options: personOptions() },
        textStep('brief', 'Brief', PLAN_LIMITS.brief, { long: true, hint: 'What the work is, so its owner can start without asking.' }),
        textStep('doneWhen', 'Done when', PLAN_LIMITS.doneWhen, { long: true }),
      ],
    });
    for (const t of company.tasks.filter(isOpen)) {
      const owner = people.find((p) => p.id === t.owner);
      const ownerWords = owner ? `${owner.name} ${owner.title}` : t.owner;
      const hint = owner ? `${capital(called(owner))}'s task` : null;
      const title = taskTitle(t);
      if (t.paused) add({ id: `resume-task:${t.id}`, label: `Resume ${title}`, section: 'Tasks', words: `task ${ownerWords} ${t.id} ${SYNONYMS.resume}`, hint, action: { kind: 'resume-task', task: t.id } });
      else add({ id: `pause-task:${t.id}`, label: `Pause ${title}`, section: 'Tasks', words: `task ${ownerWords} ${t.id} ${SYNONYMS.pause}`, hint, action: { kind: 'pause-task', task: t.id } });
      add({
        id: `cancel-task:${t.id}`,
        label: `Cancel ${title}`,
        section: 'Tasks',
        words: `task ${ownerWords} ${t.id} ${SYNONYMS.cancel}`,
        hint: 'The work stays on a branch',
        action: { kind: 'cancel-task', task: t.id },
        steps: [textStep('reason', 'Why cancel it?', PLAN_LIMITS.note, { long: true })],
      });
      add({
        id: `reassign-task:${t.id}`,
        label: `Reassign ${title}`,
        section: 'Tasks',
        words: `task ${ownerWords} ${t.id} ${SYNONYMS.reassign}`,
        hint,
        action: { kind: 'reassign-task', task: t.id },
        steps: [
          { kind: 'choice', key: 'to', label: 'Who takes it over?', options: personOptions([t.owner]) },
          textStep('note', 'Handover note (optional)', PLAN_LIMITS.note, { optional: true, long: true, hint: 'What they need to know: they also get the brief and what was done so far.' }),
        ],
      });
    }
  }

  // People: leash, model, effort
  if (steering) {
    for (const p of people) {
      const draft = personDraft(company, p);
      const words = `${p.name} ${p.title} ${roomName(snapshot, p.room)}`;
      const now = steeringOf(company, p.id);
      add({
        id: `leash:${p.id}`,
        label: `Change ${called(p)}'s leash`,
        section: 'People',
        words: `${words} ${SYNONYMS.leash}`,
        hint: `${p.title}. Now: ${LEASH_WORDS[now.leash]}`,
        action: { kind: 'leash', person: p.id },
        steps: [{ kind: 'choice', key: 'leash', label: `${capital(called(p))}'s leash`, options: leashChoices(company, p).map((c) => ({ value: c.value, label: c.label, hint: c.value === draft.leash ? 'Now' : null })) }],
      });
      add({
        id: `model:${p.id}`,
        label: `Change ${called(p)}'s model`,
        section: 'People',
        words: `${words} ${SYNONYMS.model}`,
        hint: `${p.title}. Now: ${modelName(p.model)}`,
        action: { kind: 'model', person: p.id },
        steps: [{ kind: 'choice', key: 'model', label: `${capital(called(p))}'s model`, options: modelChoices(p.model).map((c) => ({ value: c.value, label: c.label, hint: c.value === p.model ? 'Now' : null })) }],
      });
      add({
        id: `effort:${p.id}`,
        label: `Change ${called(p)}'s effort`,
        section: 'People',
        words: `${words} ${SYNONYMS.effort}`,
        hint: `${p.title}. Now: ${draft.effort === 'default' ? DEFAULT_EFFORT : EFFORT_WORDS[draft.effort]}`,
        action: { kind: 'effort', person: p.id },
        steps: [{ kind: 'choice', key: 'effort', label: `${capital(called(p))}'s effort`, options: effortChoices().map((c) => ({ value: c.value, label: c.label, hint: c.value === draft.effort ? 'Now' : null })) }],
      });
    }
    for (const room of [...new Set(people.map((p) => p.room))]) {
      const leash = roomLeash(company, room) ?? 'default';
      add({
        id: `room-leash:${room}`,
        label: `Change ${roomTitle(snapshot, room)}'s leash`,
        section: 'People',
        words: `room ${roomName(snapshot, room)} ${SYNONYMS.leash}`,
        hint: `Now: ${LEASH_WORDS[leash]}`,
        action: { kind: 'room-leash', room },
        steps: [{ kind: 'choice', key: 'leash', label: `${capital(roomTitle(snapshot, room))}'s leash`, options: roomChoices().map((c) => ({ value: c.value, label: c.label, hint: c.value === leash ? 'Now' : null })) }],
      });
    }
  }

  // People: hire, fire, move and rehire (the org chart's; docs/design-v3.md, "Hire, fire, move").
  const ceo = people.find((p) => p.level === 'ceo') ?? null;
  const departments = snapshot.studio?.departments ?? [];
  if (company.phase !== 'founding' && company.phase !== 'proposed' && departments.length > 0) {
    const headOf = (room: string) => people.find((p) => p.level === 'head' && p.room === room) ?? null;
    const managers: [string, string][] = departments.flatMap((d) => {
      const m = headOf(d.id) ?? ceo;
      return m ? [[d.id, m.id] as [string, string]] : [];
    });
    const library = options.library ?? null;
    const roomStep: PaletteStep = {
      kind: 'choice',
      key: 'room',
      label: 'Which room?',
      options: departments.map((d) => {
        const head = headOf(d.id);
        return { value: d.id, label: d.name, hint: library ? (head ? `Reports to ${head.name}` : 'Reports to the CEO') : null };
      }),
    };
    add({
      id: 'hire',
      label: 'Hire someone',
      section: 'People',
      words: `${SYNONYMS.hire} people team`,
      hint: library ? 'Into a room, from the library' : ceo ? `Asks ${called(ceo)} to hire` : null,
      action: { kind: 'hire', managers, rooms: departments.map((d) => [d.id, d.name] as [string, string]), ceo: ceo?.id ?? null, library: library !== null },
      steps: [
        roomStep,
        library
          ? { kind: 'choice', key: 'role', label: 'Which role?', options: library.filter((r) => !people.some((p) => p.id === r.id)).map((r) => ({ value: r.id, label: r.title, hint: capital(r.department) })) }
          : textStep('text', 'Who do you need?', LIMITS.message, { long: true, hint: `${ceo ? capital(called(ceo)) : 'The CEO'} hires them from the library or writes the role.` }),
      ],
    });
    // With the library, hiring is direct; the CEO can still be asked, for a role the library doesn't have.
    if (library && ceo) {
      add({
        id: 'hire:ask',
        label: 'Ask the CEO to hire someone',
        section: 'People',
        words: `${SYNONYMS.hire} people team write describe`,
        hint: `${capital(called(ceo))} hires them from the library or writes the role`,
        action: { kind: 'hire', managers, rooms: departments.map((d) => [d.id, d.name] as [string, string]), ceo: ceo.id, library: false },
        steps: [
          { kind: 'choice', key: 'room', label: 'Which room?', options: departments.map((d) => ({ value: d.id, label: d.name, hint: null })) },
          textStep('text', 'Who do you need?', LIMITS.message, { long: true, hint: `${capital(called(ceo))} hires them from the library or writes the role.` }),
        ],
      });
    }
    for (const p of people) {
      if (p.level === 'ceo') continue;
      const words = `${p.name} ${p.title} ${roomName(snapshot, p.room)}`;
      add({
        id: `move:${p.id}`,
        label: `Move ${called(p)} to another room`,
        section: 'People',
        words: `${words} ${SYNONYMS.move}`,
        hint: `Now in ${roomName(snapshot, p.room)}. Their manager stays.`,
        action: { kind: 'move', person: p.id },
        steps: [{ kind: 'choice', key: 'room', label: `Where does ${called(p)} go?`, options: departments.filter((d) => d.id !== p.room).map((d) => ({ value: d.id, label: d.name, hint: null })) }],
      });
      add({
        id: `fire:${p.id}`,
        label: `Fire ${called(p)}`,
        section: 'People',
        words: `${words} ${SYNONYMS.fire}`,
        hint: `${p.title}. Their work goes back to their manager.`,
        action: { kind: 'fire', person: p.id },
      });
    }
    for (const f of snapshot.studio?.fired ?? []) {
      add({
        id: `rehire:${f.id}`,
        label: `Rehire ${f.name ?? f.title}`,
        section: 'People',
        words: `${f.title} ${roomName(snapshot, f.department)} ${SYNONYMS.rehire}`,
        hint: f.name && f.name !== f.title ? f.title : null,
        action: { kind: 'rehire', role: f.id },
      });
    }
  }

  // Decisions
  const decisions = [...(company.steering?.decisions ?? [])].sort((a, b) => b.at - a.at);
  if (steering) {
    const last = decisions.find((d) => d.reversible && d.undone === null);
    if (last) add({ id: 'undo-last', label: `Undo the last decision: ${clip(plainText(last.what), 80)}`, section: 'Decisions', words: SYNONYMS.undo, hint: null, action: { kind: 'undo-decision', decision: last.id }, suggested: true });
    for (const d of decisions) {
      add({ id: `open:decision:${d.id}`, label: `Decision: ${clip(plainText(d.what), 90)}`, section: 'Decisions', words: `decision ${d.kind} ${SYNONYMS.open}`, hint: null, action: { kind: 'open', path: decisionPath(d.id) }, sends: false });
    }
  }

  // Go to
  const view = (id: string, label: string, path: string, words: string, suggested = false) =>
    add({ id: `open:${id}`, label, section: 'Go to', words: `${words} ${SYNONYMS.open}`, action: { kind: 'open', path }, sends: false, suggested });
  view('progress', 'Open progress', 'progress', 'checklist milestones since overview goal', true);
  view('inbox', 'Open the inbox', 'inbox', 'questions approvals answers', true);
  view('org', 'Open the org chart', 'org', 'people team who');
  view('tasks', 'Open the task board', 'tasks', 'work board columns');
  view('dashboards', 'Open the dashboards', 'dashboards', 'progress spend timeline');
  if (steering) view('decisions', 'Open the decision log', 'decisions', 'decisions log history', true);
  if (options.feed) add({ id: 'open:feed', label: 'Open the feed', section: 'Go to', words: `conversation messages replies talk ${SYNONYMS.open}`, action: { kind: 'feed', catchUp: false }, sends: false, suggested: true });
  if (options.feed && options.catchUp) add({ id: 'catch-up', label: 'Catch me up', section: 'Go to', words: 'digest summary what happened since', hint: 'A few sentences on what happened since you last caught up', action: { kind: 'feed', catchUp: true }, sends: false, suggested: true });
  view('preview', 'Open the preview', 'preview', 'app screen');
  view('customize', 'Customize the office', 'customize', 'theme rooms decor looks');
  view('settings', 'Open Settings', 'settings', 'desks rules');
  for (const p of people) {
    add({ id: `open:person:${p.id}`, label: `Open ${personLabel(p)}`, section: 'Go to', words: `${p.title} ${roomName(snapshot, p.room)} ${p.id} conversation ${SYNONYMS.open}`, hint: roomName(snapshot, p.room), action: { kind: 'open', path: `people/${encodeURIComponent(p.id)}` }, sends: false });
  }
  for (const t of company.tasks) {
    const owner = people.find((p) => p.id === t.owner);
    add({ id: `open:task:${t.id}`, label: `Open ${taskTitle(t)}`, section: 'Go to', words: `task ${owner ? `${owner.name} ${owner.title}` : ''} ${t.id} ${SYNONYMS.open}`, hint: owner ? `${capital(called(owner))}'s task` : null, action: { kind: 'open', path: `tasks/${encodeURIComponent(t.id)}` }, sends: false });
  }
  const traced = new Set<string>();
  for (const m of [...company.messages].sort((a, b) => b.at - a.at)) {
    if (m.from !== STAKEHOLDER || m.relayOf || traced.size >= 20) continue;
    const key = m.audience?.group ?? m.id;
    if (traced.has(key)) continue;
    traced.add(key);
    const to = m.audience ? m.audience.title : nameOf(company, m.to).called;
    add({ id: `open:trace:${key}`, label: `Where it went: “${clip(plainText(m.text), 60)}”`, section: 'Go to', words: `trace message ${to} acknowledged`, hint: `To ${to}`, action: { kind: 'open', path: tracePath(key) }, sends: false });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Finding

/** Lower case without accents, so "lea" finds "Léa". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function inOrder(needle: string, hay: string): boolean {
  let at = 0;
  for (const ch of hay) if (ch === needle[at]) at += 1;
  return at >= needle.length;
}

/** How well one typed word matches one word: whole, its start, inside it, or its letters in order from the first. */
function wordScore(typed: string, word: string): number {
  if (word === typed) return 3;
  if (word.startsWith(typed)) return 2 + typed.length / word.length / 2;
  if (typed.length >= 3 && word.includes(typed)) return 1;
  if (typed.length >= 2 && word[0] === typed[0] && inOrder(typed, word)) return 0.5;
  return 0;
}

/**
 * A fuzzy match on words: every typed word has to match a word of the label or of the extra words. Label words count
 * more, and typed words in the label's own order count a little more. Null when a typed word matches nothing.
 */
export function matchScore(query: string, label: string, words = ''): number | null {
  const typed = wordsOf(query);
  if (typed.length === 0) return 0;
  const own = wordsOf(label);
  const extra = wordsOf(words);
  let score = 0;
  let last = -1;
  let ordered = true;
  for (const t of typed) {
    let best = 0;
    let at = -1;
    own.forEach((w, i) => {
      const s = wordScore(t, w) * 1.5;
      if (s > best) {
        best = s;
        at = i;
      }
    });
    for (const w of extra) {
      const s = wordScore(t, w);
      if (s > best) {
        best = s;
        at = -1;
      }
    }
    if (best === 0) return null;
    score += best;
    if (at >= 0) {
      if (at < last) ordered = false;
      last = at;
    }
  }
  return score + (ordered ? 0.5 : 0);
}

/** How many results the list shows at once; more words narrow it. */
export const RESULTS_SHOWN = 40;

/** The commands a query finds, best first; recent ones rise. */
export function findCommands(commands: readonly PaletteCommand[], query: string, recents: readonly string[]): PaletteCommand[] {
  const scored: { c: PaletteCommand; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const s = matchScore(query, c.label, `${c.words} ${c.hint ?? ''}`);
    if (s === null) return;
    const recent = recents.indexOf(c.id);
    scored.push({ c, score: s + (recent >= 0 ? 1.5 - recent * 0.1 : 0), i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.c);
}

/** Choices a query finds, in their own order. */
export function findOptions(options: readonly PaletteOption[], query: string): PaletteOption[] {
  if (wordsOf(query).length === 0) return [...options];
  return options
    .map((o, i) => ({ o, i, s: matchScore(query, o.label, o.hint ?? '') }))
    .filter((x): x is { o: PaletteOption; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.o);
}

/** How many actions the palette offers before anything is typed; typing finds every one. */
export const BROWSE_SHOWN = 8;

/** Before anything is typed: a few recent actions, then suggested ones, eight in all. */
export function browse(commands: readonly PaletteCommand[], recents: readonly string[]): { title: string; commands: PaletteCommand[] }[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const recent = recents
    .flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    })
    .slice(0, 3);
  const taken = new Set(recent.map((c) => c.id));
  const suggested = commands.filter((c) => c.suggested && !taken.has(c.id)).slice(0, BROWSE_SHOWN - recent.length);
  return [...(recent.length > 0 ? [{ title: 'Recent', commands: recent }] : []), ...(suggested.length > 0 ? [{ title: 'Suggested', commands: suggested }] : [])];
}

/** What the list says for screen readers once typing settles: "12 actions.", "No action matches. Try another word." */
export function resultsLine(found: number, shown: number, choosing: boolean): string {
  const noun = choosing ? ['choice', 'choices'] : ['action', 'actions'];
  if (found === 0) return choosing ? 'No choice matches. Try another word.' : 'No action matches. Try another word.';
  const n = (x: number) => (x <= 12 ? capital(countWord(x)) : String(x));
  if (shown < found) return `${n(found)} ${noun[1]}, the best ${shown} shown. Type more to narrow them.`;
  return `${n(found)} ${found === 1 ? noun[0] : noun[1]}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// After a command runs

/** What the live region says once a command has run. */
export function doneLine(snapshot: Source, company: Company, command: PaletteCommand, args: Readonly<Record<string, string>>): string | null {
  const a = command.action;
  const person = (id: string) => {
    const p = company.people.find((x) => x.id === id);
    return p ? called(p) : 'them';
  };
  const task = (id: string) => {
    const t = company.tasks.find((x) => x.id === id);
    return t ? taskTitle(t) : 'the task';
  };
  switch (a.kind) {
    case 'open':
    case 'feed':
      return null;
    case 'message':
      return `Sent to ${a.to.kind === 'person' ? person(a.to.id) : a.to.kind === 'room' ? roomTitle(snapshot, a.to.id) : a.to.kind === 'team' ? `${person(a.to.head)}'s team` : 'everyone'}.`;
    case 'stop':
      return `Stopped ${person(a.person)}.`;
    case 'pause-company':
      return 'Work is paused. Everyone stops after their current step.';
    case 'resume-company':
      return 'Work resumed.';
    case 'pause-room':
      return `Paused ${roomTitle(snapshot, a.room)}.`;
    case 'resume-room':
      return `Resumed ${roomTitle(snapshot, a.room)}.`;
    case 'approve-plan':
      return a.through ? `Approved the plan through its next milestone.` : `Approved version ${a.version} of the plan.`;
    case 'pause-task':
      return `Paused ${task(a.task)}.`;
    case 'resume-task':
      return `Resumed ${task(a.task)}.`;
    case 'cancel-task':
      return `Cancelled ${task(a.task)}. The work stays on its branch.`;
    case 'reassign-task':
      return `Handed ${task(a.task)} to ${person(args.to ?? '')}.`;
    case 'create-task':
      return `Created “${clip(plainText(args.title ?? ''), 60)}” for ${person(args.owner ?? '')}.`;
    case 'leash': {
      const leash = args.leash;
      return leash === 'room' ? `${capital(person(a.person))} follows their room's leash now.` : `${capital(person(a.person))}'s leash is now: ${isLeashWord(leash) ? LEASH_WORDS[leash].toLowerCase() : 'changed'}.`;
    }
    case 'room-leash':
      return `${capital(roomTitle(snapshot, a.room))}'s leash is now: ${isLeashWord(args.leash) ? LEASH_WORDS[args.leash].toLowerCase() : 'changed'}.`;
    case 'model':
      return `${capital(person(a.person))} runs on ${modelName(args.model ?? '')} from their next desk.`;
    case 'effort': {
      const effort = args.effort;
      return `${capital(person(a.person))} works at ${isEffortWord(effort) ? `${EFFORT_WORDS[effort].toLowerCase()} effort` : `${DEFAULT_EFFORT} effort`} from their next desk.`;
    }
    case 'undo-decision':
      return 'Undone.';
    case 'hire': {
      if (!a.library) return `Sent to ${a.ceo ? person(a.ceo) : 'the CEO'}.`;
      const manager = a.managers.find(([room]) => room === args.room)?.[1];
      return `Hired for ${roomName(snapshot, args.room ?? '')}${manager ? `, reporting to ${person(manager)}` : ''}.`;
    }
    case 'fire': {
      const p = company.people.find((x) => x.id === a.person);
      const back = p?.reportsTo ? person(p.reportsTo) : 'their manager';
      return `${capital(person(a.person))} was fired. Their work goes back to ${back}.`;
    }
    case 'move': {
      const p = company.people.find((x) => x.id === a.person);
      const manager = p?.reportsTo ? company.people.find((x) => x.id === p.reportsTo) : undefined;
      const still = manager && manager.level !== 'ceo' ? ` and still reports to ${called(manager)}` : '';
      return `${capital(person(a.person))} moved to ${roomName(snapshot, args.room ?? '')}${still}.`;
    }
    case 'rehire': {
      const f = snapshot.studio?.fired.find((x) => x.id === a.role);
      return `${f?.name ?? f?.title ?? 'They'} ${f ? 'is' : 'are'} back at their desk.`;
    }
  }
}

const isLeashWord = (v: string | undefined): v is Leash => v === 'check' || v === 'default' || v === 'trusted';
const isEffortWord = (v: string | undefined): v is Effort => v !== undefined && Object.hasOwn(EFFORT_WORDS, v);

/** A text step's answer, as a command takes it: trimmed; an optional one left empty takes its default. */
export function stepValue(step: PaletteStep, raw: string): { ok: true; value: string } | { ok: false; why: string } {
  if (step.kind === 'choice') return step.options.some((o) => o.value === raw) ? { ok: true, value: raw } : { ok: false, why: 'Pick one of the choices.' };
  const value = raw.trim();
  const length = [...value].length;
  if (length > step.max) return { ok: false, why: `${length.toLocaleString('en-US')} of ${step.max.toLocaleString('en-US')}. Shorten it by ${(length - step.max).toLocaleString('en-US')}.` };
  if (!value && !step.optional) return { ok: false, why: 'Write something first.' };
  return { ok: true, value };
}

/** What Stop sends when its instruction is left empty. */
export const STOP_INSTRUCTION = (args: Readonly<Record<string, string>>): string => (args.instruction?.trim() ? args.instruction.trim() : STOP_AND_WAIT);

// ---------------------------------------------------------------------------------------------------------------
// Recents and the shortcut

const RECENTS_MAX = 8;
export const recentsKey = (companyId: string): string => `worklings-palette-recent:${companyId}`;

/** The commands this browser ran last in this company, newest first; nothing where storage is switched off. */
export function readRecents(storage: Pick<Storage, 'getItem'>, companyId: string): string[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(recentsKey(companyId)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    // Storage switched off or a value from elsewhere: no recents, the palette still works.
    return [];
  }
}

export function keepRecent(storage: Pick<Storage, 'getItem' | 'setItem'>, companyId: string, id: string): string[] {
  const next = [id, ...readRecents(storage, companyId).filter((x) => x !== id)].slice(0, RECENTS_MAX);
  try {
    storage.setItem(recentsKey(companyId), JSON.stringify(next));
  } catch {
    // Not remembered where storage is switched off; the command still ran.
  }
  return next;
}

/** What the shortcut reads of a key press (a KeyboardEvent has all of it). */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Ctrl+K, or Cmd+K on a Mac (where Ctrl+K stays the text fields' own). */
export function isPaletteKey(e: KeyPress, mac: boolean): boolean {
  if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

export const isMacLike = (userAgent: string): boolean => /Mac|iPhone|iPad|iPod/.test(userAgent);
export const shortcutLabel = (mac: boolean): string => (mac ? '⌘K' : 'Ctrl+K');
/** For aria-keyshortcuts. */
export const shortcutKeys = (mac: boolean): string => (mac ? 'Meta+K' : 'Control+K');

// ---------------------------------------------------------------------------------------------------------------
// Running a command

/** The office call a command makes, with its arguments: what Palette runs, and what the tests check. */
export type PaletteCall =
  | { on: 'navigate'; path: string }
  /** The talk bar's feed, opened over it; `catchUp` asks for v2's digest too. */
  | { on: 'talk'; method: 'openFeed'; args: [catchUp: boolean] }
  | { on: 'actions'; method: 'say'; args: [person: string, text: string, options: SendOptions] }
  | { on: 'actions'; method: 'stop'; args: [person: string, instruction: string, options: SendOptions] }
  | { on: 'actions'; method: 'pause' | 'resume'; args: [] }
  /** Hire, fire, move, rehire: v2's reshape; a refusal (`ok: false`) fails the call with its sentence. */
  | { on: 'actions'; method: 'reshape'; args: [action: ReshapeAction] }
  | { on: 'steer'; method: 'send'; args: [to: Recipient, text: string, forPeople: string[], options: SendOptions] }
  | { on: 'steer'; method: 'pauseRoom' | 'resumeRoom' | 'pauseTask' | 'resumeTask' | 'undoDecision'; args: [id: string] }
  | { on: 'steer'; method: 'approvePlan'; args: [version: number, through: string | null] }
  | { on: 'steer'; method: 'cancelTask'; args: [task: string, reason: string] }
  | { on: 'steer'; method: 'reassignTask'; args: [task: string, to: string, note: string] }
  | { on: 'steer'; method: 'createTask'; args: [input: NewTaskInput] }
  | { on: 'steer'; method: 'changeSettings'; args: [change: SettingsChange] };

const asLeash = (v: string | undefined): Leash | null => (isLeashWord(v) ? v : null);
const asEffort = (v: string | undefined): Effort | null => (isEffortWord(v) ? v : null);

/** The call a command makes once every step has its answer (stepValue's). */
export function callOf(action: PaletteAction, args: Readonly<Record<string, string>>): PaletteCall {
  const arg = (key: string) => args[key] ?? '';
  switch (action.kind) {
    case 'open':
      return { on: 'navigate', path: action.path };
    case 'feed':
      return { on: 'talk', method: 'openFeed', args: [action.catchUp] };
    case 'message':
      // The message step's words are always the person's own (it can't be left empty).
      return action.to.kind === 'person'
        ? { on: 'actions', method: 'say', args: [action.to.id, arg('text'), { typed: true }] }
        : { on: 'steer', method: 'send', args: [action.to, arg('text'), [], { typed: true }] };
    case 'stop':
      // Typed only when the person wrote an instruction; left empty, Stop sends the office's default words.
      return { on: 'actions', method: 'stop', args: [action.person, STOP_INSTRUCTION(args), { typed: Boolean(args.instruction?.trim()) }] };
    case 'pause-company':
      return { on: 'actions', method: 'pause', args: [] };
    case 'resume-company':
      return { on: 'actions', method: 'resume', args: [] };
    case 'pause-room':
      return { on: 'steer', method: 'pauseRoom', args: [action.room] };
    case 'resume-room':
      return { on: 'steer', method: 'resumeRoom', args: [action.room] };
    case 'approve-plan':
      return { on: 'steer', method: 'approvePlan', args: [action.version, action.through] };
    case 'pause-task':
      return { on: 'steer', method: 'pauseTask', args: [action.task] };
    case 'resume-task':
      return { on: 'steer', method: 'resumeTask', args: [action.task] };
    case 'cancel-task':
      return { on: 'steer', method: 'cancelTask', args: [action.task, arg('reason')] };
    case 'reassign-task':
      return { on: 'steer', method: 'reassignTask', args: [action.task, arg('to'), arg('note')] };
    case 'create-task':
      return { on: 'steer', method: 'createTask', args: [{ title: arg('title'), brief: arg('brief'), files: [], owner: arg('owner'), doneWhen: arg('doneWhen'), milestone: null }] };
    case 'leash':
      return { on: 'steer', method: 'changeSettings', args: [{ leash: { person: action.person, leash: arg('leash') === 'room' ? null : asLeash(arg('leash')) } }] };
    case 'room-leash': {
      const leash = asLeash(arg('leash'));
      return { on: 'steer', method: 'changeSettings', args: [{ leash: { room: action.room, leash: leash === 'default' ? null : leash } }] };
    }
    case 'model':
      return { on: 'steer', method: 'changeSettings', args: [{ model: { person: action.person, model: arg('model') } }] };
    case 'effort':
      return { on: 'steer', method: 'changeSettings', args: [{ effort: { person: action.person, effort: asEffort(arg('effort')) } }] };
    case 'undo-decision':
      return { on: 'steer', method: 'undoDecision', args: [action.decision] };
    case 'hire': {
      if (!action.library) {
        // The office wrote most of this sentence (and the room's title is the CEO's), so it goes without the typed mark: it
        // can't be cited as the person's own word.
        return { on: 'actions', method: 'say', args: [action.ceo ?? 'ceo', `Please hire someone for ${action.rooms.find(([room]) => room === arg('room'))?.[1] ?? arg('room')}: ${arg('text')}`, {}] };
      }
      const reportsTo = action.managers.find(([room]) => room === arg('room'))?.[1];
      return { on: 'actions', method: 'reshape', args: [{ action: 'hire', role: arg('role'), department: arg('room'), ...(reportsTo ? { reportsTo } : {}) }] };
    }
    case 'fire':
      return { on: 'actions', method: 'reshape', args: [{ action: 'fire', role: action.person }] };
    case 'move':
      return { on: 'actions', method: 'reshape', args: [{ action: 'move', role: action.person, department: arg('room') }] };
    case 'rehire':
      return { on: 'actions', method: 'reshape', args: [{ action: 'rehire', role: action.role }] };
  }
}

/**
 * Whether a decision is the one a palette call made, so its toast's Undo takes back that change and nothing else: yours,
 * new since the call, still reversible and about what the call named. A change someone else made meanwhile never matches,
 * and a call that makes no decision of its own (a message, a Stop, pausing the whole company) matches none.
 */
export function madeByCall(call: PaletteCall, before: ReadonlySet<string>, d: Decision): boolean {
  if (before.has(d.id) || d.by !== STAKEHOLDER || !d.reversible || d.undone !== null) return false;
  if (call.on !== 'steer') return false;
  switch (call.method) {
    case 'pauseTask':
    case 'resumeTask':
    case 'cancelTask':
    case 'reassignTask':
      return d.kind === 'task' && d.links.task === call.args[0];
    case 'pauseRoom':
    case 'resumeRoom':
      return d.kind === 'task' && d.rooms.includes(call.args[0]);
    case 'createTask':
      return d.kind === 'task' && d.people.includes(call.args[0].owner);
    case 'approvePlan':
      return d.kind === 'plan' && d.links.planVersion === call.args[0];
    case 'changeSettings': {
      const change = call.args[0];
      if (change.leash) return d.kind === 'leash' && ('person' in change.leash ? d.people.includes(change.leash.person) : d.rooms.includes(change.leash.room));
      const person = change.model?.person ?? change.effort?.person;
      return person !== undefined && d.kind === 'setting' && d.people.includes(person);
    }
    case 'send':
    case 'undoDecision':
      return false;
  }
}

/** The button that finishes a command's last step. */
export function runWord(action: PaletteAction): string {
  switch (action.kind) {
    case 'message':
      return 'Send';
    case 'stop':
      return 'Stop them';
    case 'cancel-task':
      return 'Cancel the task';
    case 'reassign-task':
      return 'Hand it over';
    case 'create-task':
      return 'Create the task';
    case 'hire':
      return action.library ? 'Hire them' : 'Ask the CEO';
    case 'fire':
      return 'Fire them';
    case 'move':
      return 'Move them';
    case 'rehire':
      return 'Rehire them';
    default:
      return 'Done';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The talk bar's chips

/** A chip under an empty talk bar: a suggested palette command, run as the palette runs it; `draft` fills its words. */
export interface TalkChip {
  id: string;
  label: string;
  draft: string | null;
}

/** The chips' commands, in the order they are offered: what a person not used to commands most often wants. */
const CHIP_ORDER = ['catch-up', 'message:ceo', 'raise-budget', 'resume-company', 'pause-company'] as const;

/**
 * Three or four plain things to do from an empty talk bar, taken from the palette's suggested commands: Catch me up, ask
 * the CEO how it's going (the message command with its words filled in), Raise the budget, Resume or Pause work.
 */
export function talkChips(commands: readonly PaletteCommand[], company: Pick<CompanyView, 'people'>, max = 4): TalkChip[] {
  const suggested = commands.filter((c) => c.suggested);
  const out: TalkChip[] = [];
  for (const id of CHIP_ORDER) {
    if (id === 'message:ceo') {
      const ceo = company.people.find((p) => p.level === 'ceo');
      const c = ceo ? suggested.find((x) => x.id === `message:person:${ceo.id}`) : undefined;
      // By their name, as the talk bar's box says it ("Say something to Mara"); "the CEO" when they have none of their own.
      // A plain job's one person is Claude Code itself, never "the CEO".
      const who = ceo && isPlainPerson(ceo) ? ceo.title : ceo && ceo.name.trim() && ceo.name !== ceo.title ? ceo.name : 'the CEO';
      if (ceo && c) out.push({ id: c.id, label: `Ask ${who} how it's going`, draft: 'How is it going?' });
      continue;
    }
    const c = suggested.find((x) => x.id === id);
    if (c) out.push({ id: c.id, label: c.label, draft: null });
  }
  return out.slice(0, max);
}
