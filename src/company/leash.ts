// The leash and the company's settings (SPEC-v3.md "Steering", 6 and "Also"): each person's leash (their own, else
// their room's, else the company's approvals), effort and model, which reach their next desk; the "check with me"
// start that holds each new task in the inbox; and changeSettings, the one path the office's Settings and the CEO's
// change_settings both take. The stakeholder may change everything. The CEO acts only on the stakeholder's word, cited
// and newer than the setting's last change, and making someone Trusted that way waits for the stakeholder's yes.
// Every change is a decision Undo can take back. Pure over the SteerCtx, like board.ts and plan.ts.
import { type Effort, EFFORTS, type Leash, LEASHES, PLAN_APPROVALS, type PlanApproval, type SettingsChange, type SteeringSettings } from '../core/steering.ts';
import { blankSettings, effectiveLeash, type SettingsUndo, type SteeringState, type UndoPlan } from '../core/steering-state.ts';
import { OrgRefusal, type Person, personById, type Question, STAKEHOLDER } from '../core/company.ts';
import { oneLine } from '../core/events.ts';
import { ROLE_MODELS } from '../core/studio.ts';
import { capital } from '../core/words.ts';
import {
  actor,
  after,
  andList,
  approvalWords,
  bossName,
  called,
  ceoOf,
  decided,
  effortWords,
  member,
  modelWords,
  type Outcome,
  roomTitle,
  stakeholderWord,
  type SteerCtx,
  type SteerEffect,
  type SteerEvent,
  type Step,
  step,
  titled,
} from './decisions.ts';
import { applyLatest } from './plan.ts';

/** Desks at once a company can have (the company's own updateSettings holds the same range). */
export const DESKS_RANGE = { min: 1, max: 20 } as const;
/** How long an idle desk stays open, in milliseconds: one minute to two hours, as the route and change_settings take it. */
export const IDLE_RANGE = { min: 60_000, max: 7_200_000 } as const;

/** What the switchboard needs of a person's steering for their next desk (DeskPlan.effort and leash). */
export function deskSteering(steering: Pick<SteeringState, 'settings'>, person: Pick<Person, 'id' | 'room'>): { effort: Effort | null; leash: Leash } {
  const p = effectiveLeash(steering.settings, person);
  return { effort: p.effort, leash: p.leash };
}

// ---------------------------------------------------------------------------------------------------------------
// Answers that steer

/**
 * The stakeholder's answer to a "check with me" question, once it took effect: option 0 hands the task out; anything
 * else pauses it, so Resume on the board starts it later. Words with the answer reach the owner as part of the task.
 */
export function gateAnswered(ctx: SteerCtx, q: Question): Outcome<void> {
  const entry = Object.entries(ctx.steering.gates).find(([, question]) => question === q.id);
  const task = ctx.state.tasks.find((t) => t.id === q.gate?.task);
  if (!entry || !q.answer || !task) return { steps: [], result: undefined };
  const [messageId] = entry;
  const events: SteerEvent[] = [{ type: 'gate', message: messageId, question: null }];
  const effects: SteerEffect[] = [];
  const cwd = task.worktree?.path;
  const start = q.answer.option === 0;
  if (start) effects.push({ kind: 'deliver', message: messageId, ...(cwd ? { cwd } : {}) });
  else if (!task.paused) events.push({ type: 'task-paused', id: task.id, paused: { at: ctx.now, by: STAKEHOLDER }, at: ctx.now });
  const words = q.answer.text.trim();
  if (words && personById(ctx.people, task.owner)) {
    const m = ctx.newMessage(STAKEHOLDER, task.owner, `On ${task.id}, ${titled(task.title)}: ${words}`, { fromOffice: true });
    events.push({ type: 'message', message: m }, { type: 'task-turn', message: m.id, task: task.id });
    if (start) effects.push({ kind: 'deliver', message: m.id, ...(cwd ? { cwd } : {}) });
  }
  return { steps: [step(events, effects)], result: undefined };
}

/** The stakeholder's yes (option 0) to making someone Trusted by talking, once it took effect. */
export function confirmAnswered(ctx: SteerCtx, q: Question): Outcome<void> {
  const confirm = Object.hasOwn(ctx.steering.confirms, q.id) ? ctx.steering.confirms[q.id] : undefined;
  if (!confirm || !q.answer) return { steps: [], result: undefined };
  const done: Step = step([{ type: 'confirm', question: q.id, confirm: null }]);
  if (q.answer.option !== 0) return { steps: [done], result: undefined };
  const target = 'person' in confirm.target ? { person: confirm.target.person, leash: 'trusted' as const } : { room: confirm.target.room, leash: 'trusted' as const };
  const word = ctx.state.messages.find((m) => m.id === confirm.cites[0]) ?? null;
  const steps = applyChange(ctx, confirm.by, { leash: target }, word, { decisions: true, question: q.id });
  return { steps: [done, ...steps], result: undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// Changing settings

/** A change as checked: only the fields given, each valid. */
type Checked = SettingsUndo;

const isLeash = (v: unknown): v is Leash => LEASHES.some((l) => l === v);
const isEffort = (v: unknown): v is Effort => EFFORTS.some((e) => e === v);
const isPlanApproval = (v: unknown): v is PlanApproval => PLAN_APPROVALS.some((p) => p === v);

function roomExists(ctx: SteerCtx, room: unknown): room is string {
  return typeof room === 'string' && (ctx.rooms.some((r) => r.id === room) || ctx.people.some((p) => p.room === room));
}

/** Checks each field of a change, refusing the whole change with the first problem. */
function checkChange(ctx: SteerCtx, input: SettingsChange): Checked {
  const raw: Record<string, unknown> = { ...input };
  const out: Checked = {};
  if (raw.maxDesks !== undefined) {
    const n = raw.maxDesks;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < DESKS_RANGE.min || n > DESKS_RANGE.max) {
      throw new OrgRefusal('invalid', `Desks at once is a whole number from ${DESKS_RANGE.min} to ${DESKS_RANGE.max}.`);
    }
    out.maxDesks = n;
  }
  if (raw.idleMs !== undefined) {
    const ms = raw.idleMs;
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < IDLE_RANGE.min || ms > IDLE_RANGE.max) {
      throw new OrgRefusal('invalid', 'An idle desk closes after 1 to 120 minutes, given in milliseconds.');
    }
    out.idleMs = ms;
  }
  if (raw.planApproval !== undefined) {
    if (!isPlanApproval(raw.planApproval)) throw new OrgRefusal('invalid', 'Plan approval is before-work, milestones or off.');
    out.planApproval = raw.planApproval;
  }
  if (raw.leash !== undefined) {
    const l = raw.leash;
    if (typeof l !== 'object' || l === null) throw new OrgRefusal('invalid', 'A leash names a person or a room, and check, default, trusted or null.');
    const value: unknown = 'leash' in l ? l.leash : undefined;
    if (value !== null && !isLeash(value)) throw new OrgRefusal('invalid', 'A leash is check, default or trusted, or null to clear one of their own.');
    if ('person' in l) out.leash = { person: member(ctx, l.person).id, leash: value };
    else if ('room' in l) {
      if (!roomExists(ctx, l.room)) throw new OrgRefusal('unknown', `There's no room ${oneLine(String(l.room), 40)} in the company.`);
      out.leash = { room: l.room, leash: value };
    } else throw new OrgRefusal('invalid', 'A leash names a person or a room.');
  }
  if (raw.effort !== undefined) {
    const e = raw.effort;
    if (typeof e !== 'object' || e === null || !('person' in e)) throw new OrgRefusal('invalid', "Effort names a person, and low, medium, high, xhigh, max or null for Claude Code's default.");
    const value: unknown = 'effort' in e ? e.effort : undefined;
    if (value !== null && !isEffort(value)) throw new OrgRefusal('invalid', "Effort is low, medium, high, xhigh or max, or null for Claude Code's default.");
    out.effort = { person: member(ctx, e.person).id, effort: value };
  }
  if (raw.model !== undefined) {
    const m = raw.model;
    if (typeof m !== 'object' || m === null || !('person' in m)) throw new OrgRefusal('invalid', 'A model change names a person and the model.');
    const model: unknown = 'model' in m ? m.model : undefined;
    if (typeof model !== 'string' || !(ROLE_MODELS as readonly string[]).includes(model)) throw new OrgRefusal('invalid', `A model is one of ${ROLE_MODELS.join(', ')}.`);
    out.model = { person: member(ctx, m.person).id, model };
  }
  if (raw.removeRule !== undefined) {
    if (typeof raw.removeRule !== 'string' || !ctx.state.settings.alwaysAllow.includes(raw.removeRule)) throw new OrgRefusal('unknown', "There's no such rule to remove.");
    out.removeRule = raw.removeRule;
  }
  if (Object.keys(out).length === 0) throw new OrgRefusal('invalid', 'Say which setting to change.');
  return out;
}

/** What each field changes, for the log's keys and what a cite must be newer than. */
function keysOf(c: Checked): string[] {
  const keys: string[] = [];
  if (c.maxDesks !== undefined) keys.push('setting:maxDesks');
  if (c.idleMs !== undefined) keys.push('setting:idleMs');
  if (c.planApproval !== undefined) keys.push('setting:planApproval');
  if (c.leash) keys.push('person' in c.leash ? `leash:person:${c.leash.person}` : `leash:room:${c.leash.room}`);
  if (c.effort) keys.push(`effort:${c.effort.person}`);
  if (c.model) keys.push(`model:${c.model.person}`);
  if (c.removeRule !== undefined) keys.push(`rule:${c.removeRule}`);
  if (c.addRule !== undefined) keys.push(`rule:${c.addRule}`);
  return keys;
}

/** The fields a change names, as the sentence of a refusal says them. */
function changeWords(ctx: SteerCtx, c: Checked): string {
  const parts: string[] = [];
  if (c.maxDesks !== undefined) parts.push('the desks at once');
  if (c.idleMs !== undefined) parts.push('how long idle desks stay open');
  if (c.planApproval !== undefined) parts.push('plan approval');
  if (c.leash) parts.push('person' in c.leash ? `${called(ctx, c.leash.person)}'s leash` : `the ${roomTitle(ctx, c.leash.room)} room's leash`);
  if (c.effort) parts.push(`${called(ctx, c.effort.person)}'s effort`);
  if (c.model) parts.push(`${called(ctx, c.model.person)}'s model`);
  if (c.removeRule !== undefined || c.addRule !== undefined) parts.push('the rule');
  return andList(parts);
}

const ownOf = <T>(record: Readonly<Record<string, T>>, key: string): T | null => (Object.hasOwn(record, key) ? (record[key] ?? null) : null);

/** The sentence of a leash change, from the log's point of view. */
function leashSentence(ctx: SteerCtx, by: string, target: { person: string } | { room: string }, leash: Leash | null, asked: string): string {
  const who = actor(ctx, by);
  if ('person' in target) {
    const name = called(ctx, target.person);
    const p = personById(ctx.people, target.person);
    if (leash === null) {
      const room = p ? effectiveLeash({ ...ctx.steering.settings, leash: { ...ctx.steering.settings.leash, people: {} } }, p).leash : 'default';
      return `${who} cleared ${name}'s own leash${asked}, so ${name} follows ${p ? `the ${roomTitle(ctx, p.room)} room` : 'their room'}: ${room === 'check' ? 'checking with you before each task' : room === 'trusted' ? 'Trusted' : "the company's approvals"}.`;
    }
    if (leash === 'check') return `${who} set ${name} to check with you before each task${asked}.`;
    if (leash === 'trusted') return `${who} made ${name} Trusted${asked}.`;
    return `${who} put ${name} on the company's approvals${asked}.`;
  }
  const room = `the ${roomTitle(ctx, target.room)} room`;
  if (leash === null) return `${who} cleared ${room}'s leash${asked}, so its people are on the company's approvals unless they have their own.`;
  if (leash === 'check') return `${who} set ${room} to check with you before each task${asked}.`;
  if (leash === 'trusted') return `${who} made ${room} Trusted${asked}.`;
  return `${who} put ${room} on the company's approvals${asked}.`;
}

interface ApplyOptions {
  /** Record a decision per field: false for an undo, which records its own. */
  decisions: boolean;
  /** The inbox question that confirmed it (Trusted by talking). */
  question?: string;
}

/**
 * The steps that make a checked change real: steering's settings, the company's own through its path, the model
 * through reshape, gates released for anyone who no longer checks with the stakeholder, the plan applied when approval
 * goes off, and a decision for each field with the change that undoes it.
 */
function applyChange(ctx: SteerCtx, by: string, c: Checked, word: { id: string } | null, o: ApplyOptions): Step[] {
  const before = ctx.steering.settings;
  const next: SteeringSettings = {
    planApproval: c.planApproval ?? before.planApproval,
    leash: { people: Object.assign(blankSettings('off').leash.people, before.leash.people), rooms: Object.assign(blankSettings('off').leash.rooms, before.leash.rooms) },
    effort: Object.assign(blankSettings('off').effort, before.effort),
  };
  if (c.leash) {
    const table = 'person' in c.leash ? next.leash.people : next.leash.rooms;
    const key = 'person' in c.leash ? c.leash.person : c.leash.room;
    if (c.leash.leash === null) delete table[key];
    else table[key] = c.leash.leash;
  }
  if (c.effort) {
    if (c.effort.effort === null) delete next.effort[c.effort.person];
    else next.effort[c.effort.person] = c.effort.effort;
  }
  const events: SteerEvent[] = [];
  const effects: SteerEffect[] = [];
  const steeringChanged = c.planApproval !== undefined || c.leash !== undefined || c.effort !== undefined;
  if (steeringChanged) events.push({ type: 'steering-settings', settings: next });
  const company: Extract<SteerEffect, { kind: 'company-settings' }>['change'] = {};
  if (c.maxDesks !== undefined) company.maxDesks = c.maxDesks;
  if (c.idleMs !== undefined) company.idleMs = c.idleMs;
  if (c.removeRule !== undefined) company.removeRule = c.removeRule;
  if (c.addRule !== undefined) company.addRule = c.addRule;
  if (Object.keys(company).length > 0) effects.push({ kind: 'company-settings', by, change: company });
  if (c.model) effects.push({ kind: 'model', person: c.model.person, model: c.model.model });

  // Anyone who checked with the stakeholder and no longer does: their held starts go out now.
  for (const [messageId, questionId] of Object.entries(ctx.steering.gates)) {
    const m = ctx.state.messages.find((x) => x.id === messageId);
    const p = m ? personById(ctx.people, m.to) : undefined;
    if (!m || !p || effectiveLeash(next, p).leash === 'check') continue;
    events.push({ type: 'withdrawn', id: questionId, reason: `${capital(called(ctx, p.id))} doesn't check with you before each task any more.`, at: ctx.now }, { type: 'gate', message: messageId, question: null });
    effects.push({ kind: 'deliver', message: messageId });
  }

  if (o.decisions) {
    const asked = word ? ', as you asked' : '';
    const links = { ...(word ? { message: word.id } : {}), ...(o.question ? { question: o.question } : {}) };
    const record = (d: { kind: 'setting' | 'leash' | 'rule'; what: string; key: string; undo: SettingsUndo; people?: (string | null | undefined)[]; rooms?: (string | null | undefined)[] }) => {
      const undo: UndoPlan = { kind: 'settings', key: d.key, change: d.undo };
      events.push(decided(ctx, { by, kind: d.kind, what: d.what, people: d.people ?? [], rooms: d.rooms ?? [], links, key: d.key, undo }).event);
    };
    const who = actor(ctx, by);
    if (c.maxDesks !== undefined && c.maxDesks !== ctx.state.settings.maxDesks) {
      record({ kind: 'setting', what: `${who} set ${c.maxDesks} desk${c.maxDesks === 1 ? '' : 's'} at once${asked}.`, key: 'setting:maxDesks', undo: { maxDesks: ctx.state.settings.maxDesks } });
    }
    if (c.idleMs !== undefined && c.idleMs !== ctx.state.settings.idleMs) {
      record({ kind: 'setting', what: `${who} set idle desks to close after ${Math.round(c.idleMs / 60_000)} min${asked}.`, key: 'setting:idleMs', undo: { idleMs: ctx.state.settings.idleMs } });
    }
    if (c.planApproval !== undefined && c.planApproval !== before.planApproval) {
      record({ kind: 'setting', what: `${who} set plan approval to “${capital(approvalWords(c.planApproval))}”${asked}.`, key: 'setting:planApproval', undo: { planApproval: before.planApproval } });
    }
    if (c.leash) {
      const target = c.leash;
      const old = 'person' in target ? ownOf(before.leash.people, target.person) : ownOf(before.leash.rooms, target.room);
      if (old !== target.leash) {
        const key = 'person' in target ? `leash:person:${target.person}` : `leash:room:${target.room}`;
        const undo: SettingsUndo = { leash: 'person' in target ? { person: target.person, leash: old } : { room: target.room, leash: old } };
        const person = 'person' in target ? personById(ctx.people, target.person) : undefined;
        record({ kind: 'leash', what: leashSentence(ctx, by, target, target.leash, asked), key, undo, people: [person?.id], rooms: [person?.room ?? ('room' in target ? target.room : null)] });
      }
    }
    if (c.effort) {
      const old = ownOf(before.effort, c.effort.person);
      if (old !== c.effort.effort) {
        const p = personById(ctx.people, c.effort.person);
        record({ kind: 'setting', what: `${who} set ${called(ctx, c.effort.person)}'s effort to ${effortWords(c.effort.effort)}${asked}.`, key: `effort:${c.effort.person}`, undo: { effort: { person: c.effort.person, effort: old } }, people: [p?.id], rooms: [p?.room] });
      }
    }
    if (c.model) {
      const old = ctx.modelOf(c.model.person);
      if (old !== c.model.model) {
        const p = personById(ctx.people, c.model.person);
        record({ kind: 'setting', what: `${who} moved ${called(ctx, c.model.person)} to ${modelWords(c.model.model)}${asked}.`, key: `model:${c.model.person}`, undo: { model: { person: c.model.person, model: old } }, people: [p?.id], rooms: [p?.room] });
      }
    }
    if (c.removeRule !== undefined) record({ kind: 'rule', what: `${who} removed the rule ${c.removeRule}${asked}, so it is asked again.`, key: `rule:${c.removeRule}`, undo: { addRule: c.removeRule } });
  }
  const steps: Step[] = [];
  if (events.length > 0 || effects.length > 0) steps.push(step(events, effects));
  if (c.planApproval === 'off' && before.planApproval !== 'off') steps.push(...applyLatest({ ...ctx, ...after(ctx, steps) }));
  return steps;
}

/**
 * Changes the company's settings: the stakeholder from the office, or the CEO with change_settings on the
 * stakeholder's word. Desks at once, idle time and rules go through the company's settings path, the model through
 * reshape; plan approval, leashes and effort are steering's. Making someone Trusted by talking asks the stakeholder in
 * the inbox first, and the rest of the change applies meanwhile.
 */
export function changeSettings(ctx: SteerCtx, by: string, input: SettingsChange & { cites: string[] }): Outcome<SteeringSettings> {
  const raw: unknown = input;
  if (typeof raw !== 'object' || raw === null) throw new OrgRefusal('invalid', 'Say which setting to change.');
  const { cites, ...change } = input;
  let word: { id: string } | null = null;
  const c = checkChange(ctx, change);
  if (by !== STAKEHOLDER) {
    const p = member(ctx, by);
    if (p.level !== 'ceo') throw new OrgRefusal('not-allowed', `Only the CEO changes settings, when ${bossName(ctx)} asks; tell the CEO.`);
    const since = Math.max(0, ...keysOf(c).map((k) => (Object.hasOwn(ctx.steering.changedAt, k) ? (ctx.steering.changedAt[k] ?? 0) : 0)));
    word = stakeholderWord(ctx, by, cites, since, changeWords(ctx, c));
  }
  const steps: Step[] = [];
  let apply: Checked = c;
  if (by !== STAKEHOLDER && c.leash && word) {
    const { leash, ...rest } = c;
    if (leash.leash === 'trusted') {
      apply = rest;
      steps.push(confirmStep(ctx, by, leash, word.id));
    } else {
      // Clearing someone's own leash in a Trusted room makes them Trusted too: that takes the stakeholder's yes as well.
      const next = structuredClone(ctx.steering.settings);
      const table = 'person' in leash ? next.leash.people : next.leash.rooms;
      const key = 'person' in leash ? leash.person : leash.room;
      if (leash.leash === null) delete table[key];
      else table[key] = leash.leash;
      const made = newlyTrusted(ctx.people, ctx.steering.settings, next);
      if (made.length > 0) {
        apply = rest;
        for (const id of made) steps.push(confirmStep(ctx, by, { person: id, leash: 'trusted' }, word.id));
      }
    }
  }
  if (Object.keys(apply).length > 0) steps.push(...applyChange(ctx, by, apply, word, { decisions: true }));
  return { steps, result: settingsCopy(after(ctx, steps).steering.settings) };
}

function settingsCopy(s: SteeringSettings): SteeringSettings {
  const copy = blankSettings(s.planApproval);
  Object.assign(copy.leash.people, s.leash.people);
  Object.assign(copy.leash.rooms, s.leash.rooms);
  Object.assign(copy.effort, s.effort);
  return copy;
}

/** The people who are Trusted under `to` and weren't under `from`. */
function newlyTrusted(people: readonly Person[], from: SteeringSettings, to: SteeringSettings): string[] {
  return people.filter((p) => effectiveLeash(to, p).leash === 'trusted' && effectiveLeash(from, p).leash !== 'trusted').map((p) => p.id);
}

/**
 * The steps for a change of the org that someone other than the stakeholder made (a hire, a rehire or a move): anyone
 * it made Trusted, because their room is, goes back on the company's approvals until the stakeholder says yes.
 * `wasTrusted` holds who was Trusted before the change.
 */
export function holdNewlyTrusted(ctx: SteerCtx, by: string, wasTrusted: ReadonlySet<string>): Step[] {
  const made = ctx.people.filter((p) => effectiveLeash(ctx.steering.settings, p).leash === 'trusted' && !wasTrusted.has(p.id));
  const steps: Step[] = [];
  let at = ctx;
  for (const p of made) {
    steps.push(...applyChange(at, by, { leash: { person: p.id, leash: 'default' } }, null, { decisions: false }));
    at = { ...ctx, ...after(ctx, steps) };
    steps.push(confirmStep(at, by, { person: p.id, leash: 'trusted' }, null));
  }
  return steps;
}

/** The inbox question that asks the stakeholder before the CEO's Trusted takes effect. */
function confirmStep(ctx: SteerCtx, by: string, target: { person: string; leash: Leash | null } | { room: string; leash: Leash | null }, cite: string | null): Step {
  const whom = 'person' in target ? called(ctx, target.person) : `the ${roomTitle(ctx, target.room)} room`;
  const ceo = ceoOf(ctx);
  const question: Question = {
    id: ctx.newId('question'),
    from: by,
    text: `${capital(ceo && ceo.id === by ? 'The CEO' : called(ctx, by))} would make ${whom} Trusted${cite ? ', as you asked' : ''}: routine work in the project without asking, other programs, deletes and git housekeeping included, and merging their own task's branch. Setup files and the ask list still ask you. Make ${whom} Trusted?`,
    options: [`Make ${whom} Trusted`, 'Keep the leash as it is'],
    recommended: null,
    taskId: null,
    askedAt: ctx.now,
    answer: null,
    withdrawn: null,
  };
  const confirm = { by, cites: cite ? [cite] : [], target: 'person' in target ? { person: target.person } : { room: target.room } };
  return step([{ type: 'question', question }, { type: 'confirm', question: question.id, confirm }]);
}

/** The steps of a settings undo: the change made the same way, without a decision of its own (the undo is one). */
export function settingsUndoSteps(ctx: SteerCtx, change: SettingsUndo): Step[] {
  const c: Checked = { ...change };
  if (c.removeRule !== undefined && !ctx.state.settings.alwaysAllow.includes(c.removeRule)) throw new OrgRefusal('conflict', 'That rule is gone already, so there is nothing to undo.');
  return applyChange(ctx, STAKEHOLDER, c, null, { decisions: false });
}
