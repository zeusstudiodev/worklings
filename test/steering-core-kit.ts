// A small company for steering's core tests (test/steering-{plan,board,leash,decisions}*.test.ts): the café's org, a
// world of the company's state and steering's, and a SteerCtx over it with the company's makers. `run` commits an
// operation's steps the way the company does and keeps their effects; deliveries respect held turns as the company's
// deliver does, and `land` says they reached their people.
import { type CompanyState, foldAll, foundedState, type IdKind } from '../src/core/company-state.ts';
import { type DeskState, type Message, type Person, STAKEHOLDER, type Task, THE_OFFICE } from '../src/core/company.ts';
import { FINAL_REVIEW } from '../src/core/plan.ts';
import type { Plan, PlanApproval } from '../src/core/steering.ts';
import { blankSteering, heldTurn, type SteeringIdKind, type SteeringState } from '../src/core/steering-state.ts';
import { applyEvents, type OfficeState, type Outcome, type SteerCtx, type SteerEffect, type Step, type World } from '../src/company/decisions.ts';
import { settle } from '../src/company/plan.ts';

export const NOW = Date.UTC(2026, 10, 5, 13, 0, 0);
export const MIN = 60_000;

const person = (id: string, name: string, title: string, level: Person['level'], room: string, reportsTo: string | null): Person => ({ id, name, title, level, room, reportsTo, look: {} });

/** The café's org: a CEO, two heads, a team lead and their people, the office manager and a German copywriter. */
export const PEOPLE: Person[] = [
  person('ceo', 'Noor', 'CEO', 'ceo', 'direction', null),
  person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
  person('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design'),
  person('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design'),
  person('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo'),
  person('frontend-lead', 'Ola', 'Frontend lead', 'lead', 'engineering', 'head-of-engineering'),
  person('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'frontend-lead'),
  person('backend-engineer', 'Noah', 'Backend engineer', 'worker', 'engineering', 'frontend-lead'),
  person('qa-engineer', 'QA engineer', 'QA engineer', 'worker', 'engineering', 'head-of-engineering'),
  person('german-copywriter', 'Lena', 'German copywriter', 'worker', 'content', 'ceo'),
  person('office-manager', 'Tia', 'Office manager', 'worker', 'direction', 'ceo'),
];

export const ROOMS = [
  { id: 'direction', name: 'Direction' },
  { id: 'design', name: 'Design' },
  { id: 'engineering', name: 'Engineering' },
  { id: 'content', name: 'Content' },
];

/** A raw plan as the CEO sends it, with ids where given. */
export function rawPlan(extra: Partial<Plan> = {}): Plan {
  return {
    goal: 'Customers order ahead and pick up at the counter.',
    milestones: [
      { id: 'ms-1', title: 'Menu pages live', doneWhen: 'The menu reads well on a phone.' },
      { id: 'ms-2', title: 'Pickup orders work', doneWhen: 'A guest orders, pays and picks up.' },
    ],
    tasks: [
      { id: 'p-1', title: 'Menu data', owner: 'frontend-engineer', files: ['src/menu/'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' },
      { id: 'p-2', title: 'Menu look', owner: 'ui-designer', files: ['src/styles/menu.css'], milestone: 'ms-1', after: [], brief: 'The menu in the chalk style.', doneWhen: 'It matches the design.', check: 'npm run typecheck' },
      { id: 'p-3', title: 'Slot picker', owner: 'frontend-engineer', files: ['src/slots/'], milestone: 'ms-2', after: ['p-1'], brief: 'Pick a pickup slot.', doneWhen: 'A slot is saved with the order.', check: 'npm test' },
      { id: 'p-4', title: 'Order API', owner: 'backend-engineer', files: ['api/orders/'], milestone: 'ms-2', after: [], brief: 'Save pickup orders.', doneWhen: 'Orders are stored.', check: 'npm test' },
      // The final review is the office's (checkPlan adds it to a CEO plan, whatever the CEO wrote), so it is written as the office writes it.
      { id: 'p-5', title: FINAL_REVIEW.title, owner: 'qa-engineer', files: [], milestone: 'ms-2', after: ['p-2', 'p-3', 'p-4'], brief: FINAL_REVIEW.brief, doneWhen: FINAL_REVIEW.doneWhen, kind: 'verification' },
    ],
    ...extra,
  };
}

const COMPANY_KINDS = ['task', 'message', 'question', 'approval', 'report', 'dashboard', 'screenshot', 'milestone'] as const;

export interface SimOptions {
  planApproval?: PlanApproval;
  /** The work branch; null for a project that isn't a git repository. */
  branch?: string | null;
  people?: Person[];
}

/** The company's side of steering, played in memory. */
export class Sim {
  world: World;
  now = NOW;
  people: Person[];
  fired: Person[] = [];
  desks: Record<string, DeskState> = {};
  models: Record<string, string> = {};
  office: OfficeState = { theme: 'cafe', rooms: [{ id: 'meeting', title: 'Meeting room', kind: 'meeting' }], decor: ['plant'], roomThemes: { design: null, meeting: null }, looks: { 'ui-designer': { color: '#336699' } } };
  /** Every effect so far, in order. */
  effects: SteerEffect[] = [];
  /** Turns handed to the switchboard and not delivered yet. */
  handed: string[] = [];
  /** Turns handed as interrupts (stops), by message id. */
  stops: string[] = [];
  private counters: Record<string, number> = {};

  constructor(o: SimOptions = {}) {
    this.people = (o.people ?? PEOPLE).map((p) => ({ ...p, look: { ...p.look } }));
    let state: CompanyState = foundedState({ type: 'founded', id: 'cafe', name: 'Pickup Café', root: '/projects/cafe', prompt: 'A café site.', stakeholder: 'Robin', at: NOW - 60 * MIN });
    state = foldAll(state, [{ type: 'phase', phase: 'running' }, { type: 'branch', branch: o.branch === undefined ? 'worklings/cafe' : o.branch }]);
    const steering: SteeringState = blankSteering(o.planApproval ?? 'before-work');
    this.world = { state, steering };
  }

  get state(): CompanyState {
    return this.world.state;
  }

  get steering(): SteeringState {
    return this.world.steering;
  }

  ctx(): SteerCtx {
    return {
      state: this.world.state,
      steering: this.world.steering,
      people: this.people,
      fired: this.fired,
      rooms: ROOMS,
      now: this.now,
      newId: (kind: IdKind | SteeringIdKind) => this.newId(kind),
      newMessage: (from, to, text, extra = {}) => this.newMessage(from, to, text, extra),
      deskState: (p) => this.desks[p] ?? 'closed',
      modelOf: (p) => this.models[p] ?? 'sonnet',
      office: () => structuredClone(this.office),
    };
  }

  newId(kind: IdKind | SteeringIdKind): string {
    const prefix = { task: 't', message: 'm', question: 'q', approval: 'a', report: 'r', dashboard: 'db', screenshot: 's', milestone: 'ms', decision: 'd', comment: 'c' }[kind];
    const stored = (COMPANY_KINDS as readonly string[]).includes(kind)
      ? this.world.state.counters[kind as IdKind]
      : this.world.steering.counters[kind as SteeringIdKind];
    const n = Math.max(this.counters[kind] ?? 0, stored) + 1;
    this.counters[kind] = n;
    return `${prefix}-${n}`;
  }

  newMessage(from: string, to: string, text: string, extra: { interrupt?: boolean; cites?: string[] } = {}): Message {
    return {
      id: this.newId('message'),
      from,
      to,
      text,
      origin: null,
      relayOf: null,
      note: null,
      at: this.now,
      deliveredAt: to === STAKEHOLDER ? this.now : null,
      interrupt: extra.interrupt ?? false,
      answers: null,
      ...(extra.cites ? { cites: extra.cites } : {}),
    };
  }

  /** Commits an operation's steps and carries out their effects, then gives its answer. */
  run<T>(make: (ctx: SteerCtx) => Outcome<T>): T {
    const out = make(this.ctx());
    this.apply(out.steps);
    return out.result;
  }

  apply(steps: readonly Step[]): void {
    for (const s of steps) {
      this.world = applyEvents(this.world, s.events);
      for (const e of s.effects) this.effect(e);
    }
  }

  /**
   * Steering's own follow-ups, run until nothing more comes, as the company runs them after each change. A save goes
   * out once until it is reported (`saved`), as the company keeps the saves it is running.
   */
  settle(): void {
    for (let i = 0; i < 20; i += 1) {
      let changed = false;
      for (const s of settle(this.ctx())) {
        if (s.events.length > 0) changed = true;
        this.world = applyEvents(this.world, s.events);
        for (const e of s.effects) {
          if (e.kind === 'save') {
            if (this.saves.has(e.save)) continue;
            this.saves.add(e.save);
          }
          this.effect(e);
        }
      }
      if (!changed) return;
    }
    throw new Error('Steering kept settling.');
  }

  /** Saves the company is running now. */
  readonly saves = new Set<string>();

  private effect(e: SteerEffect): void {
    this.effects.push(e);
    switch (e.kind) {
      case 'deliver':
      case 'stop':
      case 'reopen-worktree': {
        const id = e.message;
        const m = this.world.state.messages.find((x) => x.id === id);
        if (!m || m.deliveredAt !== null || m.to === STAKEHOLDER) return;
        if (heldTurn({ tasks: this.world.state.tasks, assignments: this.world.state.assignments, steering: this.world.steering }, id)) return;
        if (!this.handed.includes(id)) this.handed.push(id);
        if (e.kind === 'stop') this.stops.push(id);
        return;
      }
      case 'take-back':
        for (const id of e.messages) {
          if (!this.handed.includes(id)) continue;
          this.handed = this.handed.filter((x) => x !== id);
          if (e.unsend) this.world = applyEvents(this.world, [{ type: 'unsent', id }]);
        }
        return;
      case 'redeliver':
        return;
      case 'company-settings': {
        const s = this.world.state.settings;
        const rules = s.alwaysAllow.filter((r) => r !== e.change.removeRule);
        if (e.change.addRule !== undefined && !rules.includes(e.change.addRule)) rules.push(e.change.addRule);
        const settings = { ...s, maxDesks: e.change.maxDesks ?? s.maxDesks, idleMs: e.change.idleMs ?? s.idleMs, alwaysAllow: rules };
        this.world = applyEvents(this.world, [{ type: 'settings', settings }]);
        return;
      }
      case 'model':
        this.models[e.person] = e.model;
        return;
      case 'save':
        return;
    }
  }

  /** The switchboard says every turn handed so far reached its person. */
  land(): void {
    const ids = this.handed.splice(0);
    this.world = applyEvents(
      this.world,
      ids.map((id) => ({ type: 'delivered' as const, id, at: this.now })),
    );
    // A delivered assignment starts its task, as the company's onDelivered does.
    for (const id of ids) {
      const taskId = Object.hasOwn(this.world.state.assignments, id) ? this.world.state.assignments[id] : undefined;
      const t = taskId === undefined ? undefined : this.world.state.tasks.find((x) => x.id === taskId);
      if (t?.status === 'queued') this.world = applyEvents(this.world, [{ type: 'task-status', id: t.id, status: 'working', at: this.now }]);
    }
  }

  /** Words the stakeholder typed to someone, delivered, for the CEO or a manager to cite. */
  say(to: string, text: string): Message {
    const m: Message = { ...this.newMessage(STAKEHOLDER, to, text), typed: true };
    this.world = applyEvents(this.world, [{ type: 'message', message: m }, { type: 'delivered', id: m.id, at: this.now }]);
    return this.message(m.id);
  }

  /** A message between people, delivered. */
  post(from: string, to: string, text: string): Message {
    const m = this.newMessage(from, to, text);
    this.world = applyEvents(this.world, [{ type: 'message', message: m }, { type: 'delivered', id: m.id, at: this.now }]);
    return this.message(m.id);
  }

  done(taskId: string): void {
    this.world = applyEvents(this.world, [{ type: 'task-status', id: taskId, status: 'done', at: this.now, outcome: 'Done.' }]);
  }

  tick(ms = MIN): void {
    this.now += ms;
  }

  task(id: string): Task {
    const t = this.world.state.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`No task ${id}.`);
    return t;
  }

  /** The task made from a plan task. */
  planned(planTask: string): Task {
    const id = Object.hasOwn(this.world.steering.planTasks, planTask) ? this.world.steering.planTasks[planTask] : undefined;
    if (id === undefined) throw new Error(`No task for plan task ${planTask}.`);
    return this.task(id);
  }

  message(id: string): Message {
    const m = this.world.state.messages.find((x) => x.id === id);
    if (!m) throw new Error(`No message ${id}.`);
    return m;
  }

  messagesTo(person: string): Message[] {
    return this.world.state.messages.filter((m) => m.to === person);
  }

  /** The newest message to a person, for reading what they were told. */
  lastTo(person: string): Message {
    const m = this.messagesTo(person).at(-1);
    if (!m) throw new Error(`Nothing was sent to ${person}.`);
    return m;
  }

  /** Whether a person's turn is with the switchboard (handed and not delivered). */
  waiting(person: string): Message[] {
    return this.handed.map((id) => this.message(id)).filter((m) => m.to === person);
  }

  /** The assignment message of a task, if it was handed out. */
  assignmentOf(taskId: string): Message | undefined {
    const entry = Object.entries(this.world.state.assignments).find(([, t]) => t === taskId);
    return entry ? this.world.state.messages.find((m) => m.id === entry[0]) : undefined;
  }

  decisions() {
    return this.world.steering.decisions;
  }

  lastDecision() {
    const d = this.world.steering.decisions.at(-1);
    if (!d) throw new Error('No decision yet.');
    return d;
  }
}

/** What an OrgRefusal said, or a failure when the call went through. */
export function refusal(call: () => unknown): { code: string; message: string } {
  try {
    call();
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('It was expected to be refused, and it went through.');
}

export { STAKEHOLDER, THE_OFFICE };
