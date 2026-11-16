// A fake SteeringApi for the steering tools' and routes' tests. It keeps every call and answers as the company will:
// the plan's versions and approval (a version that isn't the latest is a conflict), one copy of a message per person
// with its audience, acknowledgements, the board, the decision log and the settings. Where the CEO acts for the
// stakeholder (approving the plan, changing a setting), every cite must be a message from the stakeholder to the CEO,
// newer than what it changes, as the contract says; the refusal is a sentence.
import { type Message, OrgRefusal, type Person, STAKEHOLDER, type Task } from '../src/core/company.ts';
import type {
  Ack,
  Audience,
  ChecklistVerdict,
  Decision,
  NewTaskInput,
  Plan,
  PlanApprovalState,
  PlanComment,
  PlanVersion,
  Recipient,
  SettingsChange,
  SteeringApi,
  SteeringSettings,
  TaskSteer,
} from '../src/core/steering.ts';

export interface SteeringFake extends SteeringApi {
  /** Every steering call, in order. */
  steered: { method: string; by: string; input: unknown }[];
  versions: PlanVersion[];
  settings: SteeringSettings;
  /** What proposePlan and editPlan answer from now on: these sentences, or (null) the plan taken as it is. */
  refusePlans(errors: string[] | null): void;
  /** Throws this from every steering call from now on, as the company would on a bug; null stops it. */
  failSteering(error: Error | null): void;
}

export interface SteeringWorld {
  people: () => readonly Person[];
  messages: () => Message[];
  tasks: () => Task[];
  now: () => number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The plan a proposal or an edit carries, as far as the fake needs it: its lists' lengths. */
function planOf(input: unknown): Plan {
  const raw = isObj(input) && isObj(input.plan) ? input.plan : isObj(input) ? input : {};
  return {
    goal: typeof raw.goal === 'string' ? raw.goal : '',
    milestones: Array.isArray(raw.milestones) ? (raw.milestones as Plan['milestones']) : [],
    tasks: Array.isArray(raw.tasks) ? (raw.tasks as Plan['tasks']) : [],
  };
}

export function steeringFake(world: SteeringWorld): SteeringFake {
  let seq = 0;
  /** When the settings last changed: a cite must be newer. Kept here, so the fake's state stays one object when it is merged into a company. */
  let settingsAt = 0;
  let planErrors: string[] | null = null;
  let failure: Error | null = null;
  const next = (prefix: string) => `${prefix}-${++seq}`;
  /** Messages and tasks are numbered as the company numbers them, after the ones it has. */
  const messageId = () => `m-${world.messages().length + 1}`;
  const fake: SteeringFake = {
    steered: [],
    versions: [],
    settings: { planApproval: 'before-work', leash: { people: {}, rooms: {} }, effort: {} },
    refusePlans(errors) {
      planErrors = errors;
    },
    failSteering(error) {
      failure = error;
    },

    proposePlan(by, input) {
      record('proposePlan', by, input);
      if (planErrors) return { ok: false, errors: planErrors };
      return { ok: true, version: version(by, planOf(input), isObj(input) && typeof input.note === 'string' ? input.note : null, citesOf(input)) };
    },
    editPlan(by, input) {
      record('editPlan', by, input);
      if (planErrors) return { ok: false, errors: planErrors };
      return { ok: true, version: version(by, planOf(input.plan), input.note, []) };
    },
    approvePlan(by, input) {
      record('approvePlan', by, input);
      const latest = fake.versions.at(-1);
      if (!latest) throw new OrgRefusal('unknown', 'There is no plan to approve yet.');
      if (input.version !== latest.version) throw new OrgRefusal('conflict', `Version ${input.version} isn't the latest: approve version ${latest.version}.`);
      cited(by, input.cites, latest.at, 'approve the plan');
      return { version: input.version, through: input.through, at: world.now(), by, cites: input.cites } satisfies PlanApprovalState;
    },
    commentPlan(by, input) {
      record('commentPlan', by, input);
      return { id: next('pc'), at: world.now(), by, version: fake.versions.at(-1)?.version ?? 1, on: input.on, text: input.text, message: messageId() } satisfies PlanComment;
    },
    send(by, input) {
      record('send', by, input);
      const people = audienceOf(input.to, by);
      if (people.length === 0) throw new OrgRefusal('unknown', 'Nobody is in that audience.');
      const group = next('g');
      const audience: Audience | null =
        input.to.kind === 'person' ? null : { kind: input.to.kind, id: input.to.kind === 'room' ? input.to.id : input.to.kind === 'team' ? input.to.head : null, title: titleOf(input.to), group };
      return people.map((to) => {
        const m: Message = { id: messageId(), from: by, to, text: input.text, origin: null, relayOf: null, note: null, at: world.now(), deliveredAt: null, interrupt: false, audience, for: input.for };
        world.messages().push(m);
        return m;
      });
    },
    ack(by, input) {
      record('ack', by, input);
      const m = world.messages().find((x) => x.id === input.message);
      if (!m) throw new OrgRefusal('unknown', `There is no message ${input.message}.`);
      if (m.to !== by) throw new OrgRefusal('not-allowed', `Message ${input.message} wasn't sent to you, so it isn't yours to acknowledge.`);
      return { id: next('k'), message: input.message, by, agree: input.agree, text: input.text, at: world.now() } satisfies Ack;
    },
    remind(by, input) {
      record('remind', by, input);
      return stakeholderMessage(input.person, `Reminder about ${input.message}.`, [input.message]);
    },
    escalate(by, input) {
      record('escalate', by, input);
      return stakeholderMessage('ceo', `Escalating ${input.message} for ${input.person}.`, [input.message]);
    },
    steerTask(by, input) {
      record('steerTask', by, input);
      return steer(by, input);
    },
    createTask(by, input) {
      record('createTask', by, input);
      return newTask(by, input);
    },
    recordDecision(by, input) {
      record('recordDecision', by, input);
      return decision(by, 'decide', input.what, input.why, input.alternatives);
    },
    undoDecision(by, id) {
      record('undoDecision', by, id);
      if (id === 'd-final') throw new OrgRefusal('conflict', "That decision can't be undone any more.");
      return decision(by, 'undo', `Undid ${id}.`, null, []);
    },
    reconsider(by, input) {
      record('reconsider', by, input);
      return stakeholderMessage('ceo', input.note, [input.decision]);
    },
    changeSettings(by, input) {
      record('changeSettings', by, input);
      cited(by, input.cites, settingsAt, 'change a setting');
      apply(input);
      settingsAt = world.now();
      return structuredClone(fake.settings);
    },
    markChecklist(by, input) {
      record('markChecklist', by, input);
      const task = world.tasks().find((t) => t.id === input.task);
      if (!task) throw new OrgRefusal('unknown', `There's no task ${input.task}.`);
      if (task.owner !== by) throw new OrgRefusal('not-allowed', `Task ${input.task} isn't yours; only the final review's owner marks the checklist.`);
      const version = fake.versions.at(-1)?.version ?? 1;
      return input.items.map(
        (i): ChecklistVerdict => ({ item: i.item, version, verdict: i.verdict, evidence: { note: i.evidence, check: i.check, files: i.files, page: i.page }, by, task: task.id, at: world.now() }),
      );
    },
  };

  function record(method: string, by: string, input: unknown) {
    fake.steered.push({ method, by, input });
    if (failure) throw failure;
  }

  function citesOf(input: unknown): string[] {
    return isObj(input) && Array.isArray(input.cites) ? input.cites.filter((c): c is string => typeof c === 'string') : [];
  }

  function version(by: string, plan: Plan, note: string | null, cites: string[]): PlanVersion {
    const v: PlanVersion = { version: fake.versions.length + 1, by, at: world.now(), plan, note, cites };
    fake.versions.push(v);
    return v;
  }

  /** The citing rule: where someone acts for the stakeholder, the stakeholder's own message to them, newer than `after`. */
  function cited(by: string, cites: readonly string[], after: number, what: string) {
    if (by === STAKEHOLDER) return;
    if (cites.length === 0) throw new OrgRefusal('not-allowed', `Only the stakeholder can ${what}: cite their message to you that asks for it.`);
    for (const id of cites) {
      const m = world.messages().find((x) => x.id === id);
      if (!m) throw new OrgRefusal('unknown', `There is no message ${id}.`);
      if (m.from !== STAKEHOLDER || m.to !== by) throw new OrgRefusal('not-allowed', `Message ${id} isn't the stakeholder's to you, so it can't ${what} for them.`);
      if (m.at <= after) throw new OrgRefusal('conflict', `Message ${id} is older than what it would change.`);
    }
  }

  function audienceOf(to: Recipient, by: string): string[] {
    const people = world.people();
    switch (to.kind) {
      case 'person':
        return [to.id];
      case 'everyone':
        return people.filter((p) => p.id !== by).map((p) => p.id);
      case 'room':
        return people.filter((p) => p.room === to.id && p.id !== by).map((p) => p.id);
      case 'team': {
        const under = (id: string): string[] => people.filter((p) => p.reportsTo === id).flatMap((p) => [p.id, ...under(p.id)]);
        return [to.head, ...under(to.head)].filter((id) => id !== by);
      }
    }
  }

  function titleOf(to: Recipient): string {
    if (to.kind === 'everyone') return 'everyone';
    if (to.kind === 'room') return `the ${to.id} room`;
    if (to.kind === 'team') return `${to.head}'s team`;
    return to.id;
  }

  function stakeholderMessage(to: string, text: string, cites: string[]): Message {
    const m: Message = { id: messageId(), from: STAKEHOLDER, to, text, origin: null, relayOf: null, note: null, at: world.now(), deliveredAt: null, interrupt: false, cites };
    world.messages().push(m);
    return m;
  }

  function task(id: string): Task {
    const found = world.tasks().find((t) => t.id === id);
    if (!found) throw new OrgRefusal('unknown', `There is no task ${id}.`);
    return found;
  }

  function steer(by: string, s: TaskSteer): Task[] {
    const at = world.now();
    switch (s.action) {
      case 'pause': {
        const t = task(s.task);
        t.paused = { at, by };
        return [t];
      }
      case 'resume': {
        const t = task(s.task);
        t.paused = null;
        return [t];
      }
      case 'cancel': {
        const t = task(s.task);
        t.status = 'dropped';
        t.cancel = { at, by, reason: s.reason, branch: `worklings/cancelled/${t.id}` };
        return [t];
      }
      case 'reassign': {
        const t = task(s.task);
        t.handovers = [...(t.handovers ?? []), { at, by, from: t.owner, to: s.to, note: s.note }];
        t.owner = s.to;
        return [t];
      }
      case 'order':
        return s.tasks.map((id, i) => Object.assign(task(id), { priority: i }));
      case 'pause-room':
      case 'resume-room': {
        const inRoom = new Set(world.people().filter((p) => p.room === s.room).map((p) => p.id));
        const open = world.tasks().filter((t) => inRoom.has(t.owner) && t.status !== 'done' && t.status !== 'dropped');
        for (const t of open) t.paused = s.action === 'pause-room' ? { at, by } : null;
        return open;
      }
    }
  }

  function newTask(by: string, input: NewTaskInput & { cites: string[] }): Task {
    const id = `t-${world.tasks().length + 1}`;
    const t: Task = {
      id, title: input.title, brief: input.brief, owner: input.owner, askedBy: by, files: input.files, doneWhen: input.doneWhen, status: 'queued', outcome: null,
      parent: null, milestone: input.milestone, worktree: null, commit: null, createdAt: world.now(), updatedAt: world.now(), priority: world.tasks().length, cites: input.cites,
    };
    world.tasks().push(t);
    return t;
  }

  function decision(by: string, kind: Decision['kind'], what: string, why: string | null, alternatives: string[]): Decision {
    return { id: next('d'), at: world.now(), by, kind, what, why, alternatives, people: [by], rooms: [], links: {}, reversible: kind !== 'undo', undone: null, reconsider: null };
  }

  function apply(change: SettingsChange) {
    if (change.planApproval) fake.settings.planApproval = change.planApproval;
    if (change.leash) {
      const { leash } = change.leash;
      const table = 'person' in change.leash ? fake.settings.leash.people : fake.settings.leash.rooms;
      const key = 'person' in change.leash ? change.leash.person : change.leash.room;
      // Trusted by talking waits for the stakeholder's yes in the inbox; from the office it applies at once.
      if (leash === null) delete table[key];
      else if (leash !== 'trusted' || fake.steered.at(-1)?.by === STAKEHOLDER) table[key] = leash;
    }
    if (change.effort) {
      if (change.effort.effort === null) delete fake.settings.effort[change.effort.person];
      else fake.settings.effort[change.effort.person] = change.effort.effort;
    }
  }

  return fake;
}
