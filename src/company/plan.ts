// The plan in the company (SPEC-v3.md "Steering", 1): versions that append (the CEO's propose_plan, the stakeholder's
// edit), approval of the whole plan or through a milestone (only the latest version), and the gate that follows the
// "Plan approval" setting. The approved plan becomes the task tree: its tasks are made in order with their priority,
// and each is handed to its owner when what it waits for is done and its files are free. With "at every milestone" the
// next part waits once the approved one is done; with the setting off the plan applies as proposed. While a plan
// governs, assign is limited to parts of approved work inside its files. Pure over the SteerCtx, like board.ts.
import { readdirSync } from 'node:fs';
import { carryChecklist } from '../core/checklist.ts';
import { isOpenTask } from '../core/company-state.ts';
import { type AssignInput, type Goal, LIMITS, type Message, OrgRefusal, personById, type Report, STAKEHOLDER, type Task, THE_OFFICE } from '../core/company.ts';
import { cutSentence, cutText } from '../core/cut.ts';
import { oneLine } from '../core/events.ts';
import {
  approvedScope,
  changesSentence,
  checkPlan,
  normalizePlanPath,
  pathInside,
  planChanges,
  planGoverns,
  planSize,
  waitClosure,
} from '../core/plan.ts';
import { PLAN_LIMITS, type Plan, type PlanApprovalState, type PlanComment, type PlanTask, type PlanVersion } from '../core/steering.ts';
import type { TaskFields } from '../core/steering-state.ts';
import { companySize } from '../core/size.ts';
import { harnessPlan, seatOf, soloPlan } from '../core/harness-shape.ts';
import { capital } from '../core/words.ts';
import { briefLines, cancelSteps, fileHolder, handOut, handOverSteps, priorityOrder, savesDue } from './board.ts';
import {
  actor,
  after,
  bossName,
  called,
  ceoOf,
  cleanBlock,
  decided,
  member,
  type Outcome,
  rawLength,
  stakeholderCites,
  stakeholderWord,
  type SteerCtx,
  type SteerEffect,
  type SteerEvent,
  type Step,
  step,
  titled,
  unstopped,
} from './decisions.ts';

type ProposeResult = { ok: true; version: PlanVersion; notes?: string[] } | { ok: false; errors: string[] };

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

const latestOf = (ctx: Pick<SteerCtx, 'steering'>): PlanVersion | undefined => ctx.steering.versions.at(-1);

/** The world after some steps, as the SteerCtx the next steps are worked out from. */
const ctxAfter = (ctx: SteerCtx, steps: readonly Step[]): SteerCtx => ({ ...ctx, ...after(ctx, steps) });

function newVersion(ctx: SteerCtx, by: string, plan: Plan, note: string | null, cites: string[]): PlanVersion {
  return { version: (latestOf(ctx)?.version ?? 0) + 1, by, at: ctx.now, plan, note, cites };
}

const samePlan = (a: Plan, b: Plan): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A plan sent without `contracts` takes the earlier version's, less what refers to tasks the plan no longer has. */
function withContracts(raw: unknown, earlier: Plan): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.hasOwn(raw, 'contracts') || !earlier.contracts?.length) return raw;
  const tasks = (raw as { tasks?: unknown }).tasks;
  const ids = new Set(Array.isArray(tasks) ? tasks.map((t) => (typeof t === 'object' && t !== null && typeof (t as { id?: unknown }).id === 'string' ? (t as { id: string }).id.trim() : '')) : []);
  const kept = earlier.contracts
    .filter((c) => ids.has(c.writer))
    .map((c) => ({ ...c, dependents: c.dependents.filter((d) => ids.has(d)) }))
    .filter((c) => c.dependents.length > 0);
  return kept.length > 0 ? { ...raw, contracts: kept } : raw;
}

/**
 * `structure`: the CEO's plans only, which are asked to be organised as a big plan is and to carry the checklist of what
 * the stakeholder asked for; a person's edits aren't.
 */
/** What a project has at its top level, folders marked with a slash, for the Builder's file scope; none when unreadable. */
function topLevelOf(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}

function checked(ctx: SteerCtx, raw: unknown, structure = false) {
  const size = structure ? companySize(ctx.people, ctx.state.proposal?.size) : undefined;
  // v0.4 (H5): the Lead of a harness company sends milestones; the office writes the loop's tasks from them first.
  const harness = structure && ctx.state.shape !== 'classic';
  let input = raw;
  const shaped: string[] = [];
  if (harness && typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const h =
      ctx.state.shape === 'solo'
        ? soloPlan(raw as Record<string, unknown>, ctx.people, { topLevel: topLevelOf(ctx.state.root), prompt: ctx.state.prompt })
        : harnessPlan(raw as Record<string, unknown>, ctx.people, { topLevel: topLevelOf(ctx.state.root) });
    if (h.errors.length > 0) return { ok: false as const, errors: h.errors };
    input = h.raw;
    shaped.push(...h.notes);
  }
  const check = checkPlan(input, ctx.people, { earlier: ctx.steering.versions.map((v) => v.plan), fired: ctx.fired, structure, checklist: structure, preset: ctx.state.settings.preset, ...(size ? { size } : {}), ...(harness ? { harness: true } : {}) });
  return check.ok && shaped.length > 0 ? { ...check, notes: [...shaped, ...(check.notes ?? [])] } : check;
}

/** The checklist items no task of the plan covers, as a sentence for the CEO; empty when every item is covered. */
function uncoveredWords(plan: Plan): string {
  const builds = new Set(plan.tasks.filter((t) => t.kind !== 'verification').map((t) => t.id));
  const open = (plan.checklist ?? []).filter((k) => !k.covers.some((id) => builds.has(id)));
  if (open.length === 0) return '';
  const names = open.slice(0, 5).map((k) => `${titled(k.text)} (${k.id})`);
  const more = open.length > 5 ? ` and ${open.length - 5} more` : '';
  return ` No task covers the checklist item${open.length === 1 ? '' : 's'} ${names.join(', ')}${more} yet; cover ${open.length === 1 ? 'it' : 'them'} if you revise the plan.`;
}

/** The note on a version. The CEO's, over its limit, is cut at a sentence end and says so in `cuts`; a person's is refused. */
function noteOf(raw: unknown, errors: string[], cuts?: string[]): string | null {
  if (rawLength(raw) > PLAN_LIMITS.note) {
    const cut = cuts && typeof raw === 'string' ? cutText(cleanBlock(raw, rawLength(raw)), PLAN_LIMITS.note) : null;
    if (cut && cuts) {
      cuts.push(`The note was ${cutSentence(rawLength(raw), cut)}.`);
      return cut.text || null;
    }
    errors.push(`The note is ${rawLength(raw)} characters; keep it to ${PLAN_LIMITS.note}.`);
  }
  return cleanBlock(raw, PLAN_LIMITS.note) || null;
}

// ---------------------------------------------------------------------------------------------------------------
// Versions

/** The CEO's plan, or a revision of it: a new version, checked by checkPlan. With approval off it applies at once. */
export function proposePlan(ctx: SteerCtx, by: string, input: unknown): Outcome<ProposeResult> {
  const ceo = member(ctx, by);
  if (ceo.level !== 'ceo') throw new OrgRefusal('not-allowed', `Only the CEO proposes the plan; tell the CEO what it should hold.`);
  if (ctx.state.phase !== 'running') throw new OrgRefusal('closed', "The company hasn't started yet; the plan comes once the org is hired.");
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const check = checked(ctx, input, true);
  const errors = check.ok ? [] : [...check.errors];
  const notes = check.ok ? [...(check.notes ?? [])] : [];
  const note = noteOf(fields.note, errors, notes);
  if (!check.ok || errors.length > 0) return { steps: [], result: { ok: false, errors } };
  const latest = latestOf(ctx);
  if (latest && samePlan(latest.plan, check.plan)) return { steps: [], result: { ok: true, version: structuredClone(latest), ...(notes.length > 0 ? { notes } : {}) } };
  const cites = stakeholderCites(ctx, ceo.id, fields.cites);
  const version = newVersion(ctx, ceo.id, check.plan, note, cites);
  const off = !planGoverns(ctx.steering.settings);
  const what = latest
    ? `The CEO revised the plan${cites.length > 0 ? ' as you asked' : ''}: version ${version.version}.`
    : `The CEO proposed version ${version.version} of the plan: ${planSize(version.plan)}.`;
  const { event } = decided(ctx, {
    by: ceo.id,
    kind: 'plan',
    what: off ? `${unstopped(what)}. It applies as proposed, since plan approval is off.` : what,
    why: note,
    rooms: [ceo.room],
    links: { planVersion: version.version, ...(cites[0] ? { message: cites[0] } : {}) },
    key: 'plan',
  });
  const steps = [step([{ type: 'plan-version', version }, event])];
  if (off) steps.push(...approveSteps(ctxAfter(ctx, steps), THE_OFFICE, version, null, null).steps);
  return { steps, result: { ok: true, version: structuredClone(version), ...(notes.length > 0 ? { notes } : {}) } };
}

/** The stakeholder's own edit of the plan: a new version by STAKEHOLDER, which the CEO hears of. Undo brings back the one before. */
export function editPlan(ctx: SteerCtx, by: string, input: { plan: unknown; note: unknown }): Outcome<ProposeResult> {
  if (by !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Only ${bossName(ctx)} edits the plan in the office; the CEO proposes new versions with propose_plan.`);
  const latest = latestOf(ctx);
  if (!latest) throw new OrgRefusal('closed', "There's no plan to edit yet; the CEO proposes it first.");
  // The editor may not show contracts yet: a plan sent without the field keeps the version's own, pruned to the tasks
  // that are left. If they no longer fit the edit they go, and the CEO is told, so a person's edit is never refused
  // over something they couldn't see. The checklist is carried the same way (v0.2), its covers pruned to the tasks left;
  // an item left uncovered stays, and the CEO hears of it.
  const listed = carryChecklist(input.plan, latest.plan);
  const carried = withContracts(listed, latest.plan);
  let check = checked(ctx, carried);
  let droppedContracts = false;
  if (!check.ok && carried !== listed) {
    const without = checked(ctx, listed);
    if (without.ok) {
      check = without;
      droppedContracts = true;
    }
  }
  const errors = check.ok ? [] : [...check.errors];
  const note = noteOf(input.note, errors);
  if (!check.ok || errors.length > 0) return { steps: [], result: { ok: false, errors } };
  if (samePlan(latest.plan, check.plan)) return { steps: [], result: { ok: true, version: structuredClone(latest) } };
  const changes = planChanges(latest.plan, check.plan);
  const version = newVersion(ctx, STAKEHOLDER, check.plan, note, []);
  const said = changesSentence(changes);
  const { event } = decided(ctx, {
    by: STAKEHOLDER,
    kind: 'plan',
    what: `You edited the plan, as version ${version.version}${note ? `: ${unstopped(oneLine(note, 200))}` : said ? `: ${unstopped(said).replace(/^\p{Lu}/u, (c) => c.toLowerCase())}` : ''}.`,
    why: note,
    people: [ceoOf(ctx)?.id],
    rooms: [ceoOf(ctx)?.room],
    links: { planVersion: version.version },
    key: 'plan',
    undo: { kind: 'plan', key: 'plan', version: latest.version },
  });
  const steps = [step([{ type: 'plan-version', version }, event]), ...toldCeo(ctx, `${capital(bossName(ctx))} edited the plan: version ${version.version}.${said ? ` ${said}` : ''}${note ? ` ${capital(bossName(ctx))}'s note: ${note}` : ''}${droppedContracts ? ' The contracts of the version before no longer fit the edit, so this version has none; propose them again if the streams still share an interface.' : ''}${uncoveredWords(check.plan)} Build on this version if you revise it.`)];
  if (!planGoverns(ctx.steering.settings)) steps.push(...approveSteps(ctxAfter(ctx, steps), THE_OFFICE, version, null, null).steps);
  return { steps, result: { ok: true, version: structuredClone(version) } };
}

/** The undo of a plan edit: a version's plan back as the newest version, checked again against the company as it is. */
export function revertSteps(ctx: SteerCtx, versionNumber: number): Step[] {
  const v = ctx.steering.versions.find((x) => x.version === versionNumber);
  if (!v) throw new OrgRefusal('conflict', `Version ${versionNumber} of the plan isn't kept any more.`);
  const check = checked(ctx, v.plan);
  if (!check.ok) throw new OrgRefusal('conflict', `Version ${versionNumber} can't come back as it was: ${check.errors[0] ?? 'it no longer checks out.'}`);
  const version = newVersion(ctx, STAKEHOLDER, check.plan, `Back to the plan of version ${versionNumber}.`, []);
  const steps = [step([{ type: 'plan-version', version }]), ...toldCeo(ctx, `${capital(bossName(ctx))} undid an edit of the plan: version ${version.version} is the plan of version ${versionNumber} again. Build on it if you revise it.`)];
  if (!planGoverns(ctx.steering.settings)) steps.push(...approveSteps(ctxAfter(ctx, steps), THE_OFFICE, version, null, null).steps);
  return steps;
}

function toldCeo(ctx: SteerCtx, text: string): Step[] {
  const ceo = ceoOf(ctx);
  if (!ceo) return [];
  const m = ctx.newMessage(THE_OFFICE, ceo.id, text.slice(0, LIMITS.message));
  return [step([{ type: 'message', message: m }], [{ kind: 'deliver', message: m.id }])];
}

/** A comment on the plan, a milestone or a task of the latest version: it reaches the CEO as the stakeholder's message. */
export function commentPlan(ctx: SteerCtx, by: string, input: { on: unknown; text: unknown }): Outcome<PlanComment> {
  if (by !== STAKEHOLDER) throw new OrgRefusal('not-allowed', `Only ${bossName(ctx)} comments on the plan; people message their manager.`);
  const latest = latestOf(ctx);
  if (!latest) throw new OrgRefusal('closed', "There's no plan to comment on yet.");
  const ceo = ceoOf(ctx);
  if (!ceo) throw new OrgRefusal('closed', 'The company has no CEO to read the comment.');
  if (rawLength(input.text) > PLAN_LIMITS.comment) throw new OrgRefusal('invalid', `Keep a comment to ${PLAN_LIMITS.comment.toLocaleString('en-US')} characters.`);
  const text = cleanBlock(input.text, PLAN_LIMITS.comment);
  if (!text) throw new OrgRefusal('invalid', 'Say something to comment.');
  const raw = typeof input.on === 'object' && input.on !== null ? (input.on as Record<string, unknown>) : { kind: 'plan' };
  let on: PlanComment['on'];
  let about = '';
  if (raw.kind === 'milestone' || raw.kind === 'task') {
    const id = typeof raw.id === 'string' ? raw.id : '';
    const found = raw.kind === 'milestone' ? latest.plan.milestones.find((m) => m.id === id) : latest.plan.tasks.find((t) => t.id === id);
    if (!found) throw new OrgRefusal('unknown', `Version ${latest.version} of the plan has no ${raw.kind} ${oneLine(id, 40)}.`);
    on = { kind: raw.kind, id };
    about = `, on the ${raw.kind} ${titled(found.title)}`;
  } else on = { kind: 'plan' };
  const m = ctx.newMessage(STAKEHOLDER, ceo.id, `A comment on the plan (version ${latest.version})${about}: ${text}`, { fromOffice: true });
  const comment: PlanComment = { id: ctx.newId('comment'), at: ctx.now, by, version: latest.version, on, text, message: m.id };
  return { steps: [step([{ type: 'message', message: m }, { type: 'plan-comment', comment }], [{ kind: 'deliver', message: m.id }])], result: structuredClone(comment) };
}

// ---------------------------------------------------------------------------------------------------------------
// Approval, and the task tree

/**
 * Approves the latest version, whole or through a milestone: the stakeholder from the office, or the CEO on the
 * stakeholder's word, cited and newer than both the version and the last approval. Only the latest version can be
 * approved, never less of it than before; with approval off there's nothing to approve.
 */
export function approvePlan(ctx: SteerCtx, by: string, input: { version: unknown; through: unknown; cites: unknown }): Outcome<PlanApprovalState> {
  const latest = latestOf(ctx);
  let word: Message | null = null;
  if (by !== STAKEHOLDER) {
    const p = member(ctx, by);
    if (p.level !== 'ceo') throw new OrgRefusal('not-allowed', `Only ${bossName(ctx)} approves the plan; the CEO can, citing ${bossName(ctx)}'s word.`);
    word = stakeholderWord(ctx, by, input.cites, Math.max(latest?.at ?? 0, own(ctx.steering.changedAt, 'plan-approval') ?? 0), "the plan's approval");
  }
  if (!planGoverns(ctx.steering.settings)) throw new OrgRefusal('closed', "Plan approval is off, so the plan applies as proposed; there's nothing to approve.");
  if (!latest) throw new OrgRefusal('closed', "There's no plan to approve yet; the CEO proposes it first.");
  if (input.version !== latest.version) {
    throw new OrgRefusal('conflict', `Version ${oneLine(String(input.version), 12)} isn't the latest: version ${latest.version} is. Look at it, then approve that one.`);
  }
  const through = input.through === null || input.through === undefined ? null : String(input.through);
  const ids = latest.plan.milestones.map((m) => m.id);
  if (through !== null && !ids.includes(through)) throw new OrgRefusal('unknown', `Version ${latest.version} has no milestone ${oneLine(through, 40)}.`);
  const a = ctx.steering.approved;
  if (a && a.version === latest.version) {
    const was = a.through === null ? ids.length : ids.indexOf(a.through) + 1;
    const now = through === null ? ids.length : ids.indexOf(through) + 1;
    if (now === was) return { steps: [], result: structuredClone(a) };
    if (now < was) {
      const ms = latest.plan.milestones.find((m) => m.id === a.through);
      throw new OrgRefusal('conflict', `Version ${latest.version} is approved through ${ms ? titled(ms.title) : 'a later milestone'} already; an approval can't take work back. Edit the plan instead.`);
    }
  }
  return approveSteps(ctx, by, latest, through, word);
}

/** Who reviews a plan task: the owner's manager, or the stakeholder for the CEO's own. */
const askerOf = (ctx: SteerCtx, owner: string): string => personById(ctx.people, owner)?.reportsTo ?? STAKEHOLDER;

/** The goal from the approved plan: its text and every milestone, each keeping when it was done. */
function goalOf(ctx: SteerCtx, plan: Plan): Goal {
  const before = ctx.state.goal?.milestones ?? [];
  return {
    text: plan.goal,
    milestones: plan.milestones.map((m) => ({ id: m.id, title: m.title, doneWhen: m.doneWhen, doneAt: before.find((b) => b.id === m.id)?.doneAt ?? null })),
    setAt: ctx.now,
  };
}

/**
 * The open tasks' order with the plan's: the places the plan's tasks already held on the board go to them in the
 * plan's order, and each new one goes right after the plan task before it (the ones that come first, right before the
 * first; all of them after everything else when the plan had nothing on the board yet). Other tasks keep their places.
 */
export function mergePlanOrder(current: readonly string[], planIds: readonly string[]): string[] {
  const inPlan = new Set(planIds);
  const existing = new Set(current.filter((id) => inPlan.has(id)));
  const head: string[] = [];
  const groups: string[][] = [];
  for (const id of planIds) {
    const last = groups.at(-1);
    if (existing.has(id)) groups.push([id]);
    else if (last) last.push(id);
    else head.push(id);
  }
  if (groups.length === 0) return [...current, ...head];
  const out: string[] = [];
  let g = 0;
  for (const id of current) {
    if (!inPlan.has(id)) {
      out.push(id);
      continue;
    }
    if (g === 0) out.push(...head);
    out.push(...(groups[g] ?? []));
    g += 1;
  }
  return out;
}

/** The fields of a task made from a plan task. */
function fieldsOf(ctx: SteerCtx, pt: PlanTask): Required<Pick<TaskFields, 'title' | 'brief' | 'files' | 'doneWhen' | 'milestone' | 'owner' | 'askedBy'>> {
  return { title: pt.title, brief: pt.brief, files: [...pt.files], doneWhen: pt.doneWhen, milestone: pt.milestone, owner: pt.owner, askedBy: askerOf(ctx, pt.owner) };
}

const sameFiles = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((f, i) => f === b[i]);

/** What changed between a task and the plan task it is made from, as fields and clauses for its owner. */
function fieldChanges(t: Task, want: ReturnType<typeof fieldsOf>): { fields: TaskFields; words: string[] } {
  const fields: TaskFields = {};
  const words: string[] = [];
  if (t.title !== want.title) {
    fields.title = want.title;
    words.push(`its title is now ${titled(want.title)}`);
  }
  if (t.brief !== want.brief) {
    fields.brief = want.brief;
    words.push('its brief changed');
  }
  if (!sameFiles(t.files, want.files)) {
    fields.files = want.files;
    words.push(want.files.length > 0 ? `its files are now ${want.files.join(', ')}` : 'it names no files now');
  }
  if (t.doneWhen !== want.doneWhen) {
    fields.doneWhen = want.doneWhen;
    words.push('what marks it done changed');
  }
  if (t.milestone !== want.milestone) fields.milestone = want.milestone;
  return { fields, words };
}

/**
 * What an approval does: the approval itself, the goal from the plan, and the task tree made to match the approved
 * part. Plan tasks with no task yet are made, in order; ones not handed out yet take the plan's changes; ones under way
 * take a changed owner as a handover and hear of other changes; ones the version cut are dropped, or cancelled with
 * their work kept when under way. Done and cancelled tasks stay as they are. Then every task whose turn has come is
 * handed out.
 */
function approveSteps(ctx: SteerCtx, by: string, v: PlanVersion, through: string | null, word: Message | null): Outcome<PlanApprovalState> {
  const plan = v.plan;
  const scope = new Set(through === null ? plan.milestones.map((m) => m.id) : plan.milestones.slice(0, plan.milestones.findIndex((m) => m.id === through) + 1).map((m) => m.id));
  const gone = plan.tasks.find((t) => scope.has(t.milestone) && !personById(ctx.people, t.owner));
  if (gone) {
    throw new OrgRefusal('conflict', `Version ${v.version} gives ${titled(gone.title)} to ${called(ctx, gone.owner)}, who isn't in the company any more; edit the plan, or ask the CEO to revise it.`);
  }
  const at = ctx.now;
  const approval: PlanApprovalState = { version: v.version, through, at, by, cites: word ? [word.id] : [] };
  const events: SteerEvent[] = [{ type: 'plan-approved', approval }, { type: 'goal', goal: goalOf(ctx, plan), at }];
  const mapping = ctx.steering.planTasks;
  const inPlan = new Map(plan.tasks.map((pt) => [pt.id, pt]));
  const taskById = (id: string | undefined) => (id === undefined ? undefined : ctx.state.tasks.find((t) => t.id === id));
  const begun = (t: Task) => t.status !== 'queued' || Object.values(ctx.state.assignments).includes(t.id);

  // Cut from the plan.
  const toCancel: Task[] = [];
  for (const [ptId, taskId] of Object.entries(mapping)) {
    if (inPlan.has(ptId)) continue;
    const t = taskById(taskId);
    if (!t) {
      events.push({ type: 'plan-task', planTask: ptId, task: null });
      continue;
    }
    // Done work and the stakeholder's own cancels stay; a task dropped otherwise lets the plan make it again later.
    if (!isOpenTask(t)) {
      if (t.status === 'dropped' && !t.cancel) events.push({ type: 'plan-task', planTask: ptId, task: null });
      continue;
    }
    events.push({ type: 'plan-task', planTask: ptId, task: null });
    if (begun(t)) toCancel.push(t);
    else events.push({ type: 'task-status', id: t.id, status: 'dropped', at, outcome: `Cut from the plan in version ${v.version}.` });
  }

  // Made, or brought in line with the plan. The plan's own tasks and their parts don't clash with it (checkPlan saw to
  // that), and the cut ones are going; their files are free once any save of their work is done.
  const planFamily = new Set<string>(toCancel.map((t) => t.id));
  for (const e of events) if (e.type === 'task-status') planFamily.add(e.id);
  for (const pt of plan.tasks) {
    const id = own(mapping, pt.id);
    if (id !== undefined) planFamily.add(id);
  }
  for (const t of ctx.state.tasks) if (t.parent !== null && planFamily.has(t.parent)) planFamily.add(t.id);
  const handovers: { task: Task; to: string }[] = [];
  const notes: { task: Task; words: string[] }[] = [];
  const planOrder: string[] = [];
  let made = 0;
  for (const pt of plan.tasks) {
    if (!scope.has(pt.milestone)) continue;
    const want = fieldsOf(ctx, pt);
    const existing = taskById(own(mapping, pt.id));
    const holder = fileHolder(ctx, want.files, new Set([...planFamily, ...(existing ? [existing.id] : [])]));
    if (holder && (!existing || !isOpenTask(existing) || !sameFiles(existing.files, want.files))) {
      throw new OrgRefusal(
        'conflict',
        `Version ${v.version} gives ${holder.file} to ${titled(pt.title)}, but it belongs to ${called(ctx, holder.task.owner)}'s open task ${titled(holder.task.title)}; finish or cancel that task, or change the plan.`,
      );
    }
    if (!existing || (existing.status === 'dropped' && !existing.cancel)) {
      made += 1;
      const task: Task = {
        id: ctx.newId('task'),
        ...want,
        status: 'queued',
        outcome: null,
        parent: null,
        worktree: null,
        commit: null,
        createdAt: at,
        updatedAt: at,
        priority: Number.MAX_SAFE_INTEGER - plan.tasks.length + made,
        paused: null,
        cancel: null,
        handovers: [],
        planTask: pt.id,
        cites: [],
      };
      events.push({ type: 'task', task, messageId: null }, { type: 'plan-task', planTask: pt.id, task: task.id });
      planOrder.push(task.id);
      continue;
    }
    if (!isOpenTask(existing)) continue;
    planOrder.push(existing.id);
    const { fields, words } = fieldChanges(existing, want);
    if (!begun(existing)) {
      const all: TaskFields = { ...fields, ...(existing.owner !== want.owner ? { owner: want.owner, askedBy: want.askedBy } : {}) };
      if (Object.keys(all).length > 0) events.push({ type: 'task-fields', id: existing.id, fields: all, at });
      continue;
    }
    if (Object.keys(fields).length > 0) {
      events.push({ type: 'task-fields', id: existing.id, fields, at });
      if (words.length > 0) notes.push({ task: existing, words });
    }
    if (existing.owner !== want.owner) handovers.push({ task: { ...existing, ...fields }, to: want.owner });
  }

  // The board's order with the plan's.
  const current = priorityOrder(ctx.state.tasks)
    .map((t) => t.id)
    .filter((id) => !toCancel.some((t) => t.id === id) && !events.some((e) => e.type === 'task-status' && e.id === id));
  const order = mergePlanOrder(current, planOrder);
  const withTasks = after(ctx, [step(events)]).state.tasks;
  const priorities: [string, number][] = [];
  order.forEach((id, i) => {
    const t = withTasks.find((x) => x.id === id);
    if (t && t.priority !== i + 1) priorities.push([id, i + 1]);
  });
  if (priorities.length > 0) events.push({ type: 'task-priority', priorities });

  const ms = through === null ? undefined : plan.milestones.find((m) => m.id === through);
  const part = ms ? ` through ${titled(ms.title)}` : '';
  const ceo = ceoOf(ctx);
  if (by !== THE_OFFICE) {
    events.push(
      decided(ctx, {
        by,
        kind: 'plan',
        what: `${actor(ctx, by)} approved version ${v.version} of the plan${part}${word ? ', as you asked' : ''}.`,
        people: [ceo?.id],
        rooms: [ceo?.room],
        links: { planVersion: v.version, ...(word ? { message: word.id } : {}) },
      }).event,
    );
  }
  const steps: Step[] = [step(events)];
  if (ceo && by === STAKEHOLDER) {
    steps.push(
      ...toldCeo(
        ctx,
        `${capital(bossName(ctx))} approved version ${v.version} of the plan${part}. Its tasks reach their owners as their turn comes; heads split theirs into parts with assign, naming the plan's task as parent and keeping to its files.${ms && ms.id !== plan.milestones.at(-1)?.id ? ` Once ${titled(ms.title)} is done, the next milestone waits for ${bossName(ctx)}'s approval.` : ''}`,
      ),
    );
  }
  // With approval off the office applies the version, so its author is the one who cut or moved the work.
  const mover = by === THE_OFFICE ? v.by : by;
  if (toCancel.length > 0) steps.push(...cancelSteps(ctx, mover, toCancel, `Cut from the plan in version ${v.version}`, approval.cites).steps);
  for (const h of handovers) {
    const to = personById(ctx.people, h.to);
    if (to) steps.push(...handOverSteps(ctxAfter(ctx, steps), mover, h.task, to, `Version ${v.version} of the plan gives it to ${called(ctx, to.id)}.`, []));
  }
  for (const n of notes) {
    if (!personById(ctx.people, n.task.owner) || handovers.some((h) => h.task.id === n.task.id)) continue;
    const t = after(ctx, steps).state.tasks.find((x) => x.id === n.task.id) ?? n.task;
    const m = ctx.newMessage(THE_OFFICE, t.owner, [`Version ${v.version} of the plan changes your task ${t.id}: ${n.words.join(', ')}. Here it is as it stands now.`, '', ...briefLines(t)].join('\n'));
    steps.push(step([{ type: 'message', message: m }, { type: 'task-turn', message: m.id, task: t.id }], [{ kind: 'deliver', message: m.id }]));
  }
  steps.push(...handOutsDue(ctxAfter(ctx, steps)));
  return { steps, result: structuredClone(approval) };
}

/** With approval switched off, the latest version applies as proposed: approved whole by the office, its turns handed out. */
export function applyLatest(ctx: SteerCtx): Step[] {
  const latest = latestOf(ctx);
  const a = ctx.steering.approved;
  if (!latest || (a && a.version === latest.version && a.through === null)) return [];
  return approveSteps(ctx, THE_OFFICE, latest, null, null).steps;
}

// ---------------------------------------------------------------------------------------------------------------
// Each task's turn, and the hold at a milestone

/** Tasks made from the plan whose turn hasn't come (not handed out yet). */
function waitingPlanTasks(ctx: Pick<SteerCtx, 'state' | 'steering'>): Task[] {
  const handed = new Set(Object.values(ctx.state.assignments));
  return ctx.state.tasks.filter((t) => t.planTask && t.status === 'queued' && !handed.has(t.id) && own(ctx.steering.planTasks, t.planTask) === t.id);
}

/** The plan task a task stands for: its own, or that of the plan task it is a part of. */
function planRoot(ctx: Pick<SteerCtx, 'state' | 'steering'>, t: Task): Task | undefined {
  const seen = new Set<string>();
  for (let at: Task | undefined = t; at && !seen.has(at.id); at = at.parent === null ? undefined : ctx.state.tasks.find((x) => x.id === at?.parent)) {
    seen.add(at.id);
    if (at.planTask && own(ctx.steering.planTasks, at.planTask) === at.id) return at;
  }
  return undefined;
}

/** The plan tasks a plan task still waits for: those whose task isn't done or dropped yet. */
function stillWaitsFor(ctx: Pick<SteerCtx, 'state' | 'steering'>, plan: Plan, pt: PlanTask): PlanTask[] {
  return pt.after.flatMap((id) => {
    const other = plan.tasks.find((x) => x.id === id);
    const taskId = own(ctx.steering.planTasks, id);
    const t = taskId === undefined ? undefined : ctx.state.tasks.find((x) => x.id === taskId);
    return other && !(t && (t.status === 'done' || t.status === 'dropped')) ? [other] : [];
  });
}

/**
 * What a plan task's owner needs to know about the plan's contracts and its own kind of task: the contracts it writes
 * or builds against, and what an integration or a verification task is for. Nothing for a plan without them.
 */
export function contractLines(plan: Plan, pt: PlanTask | undefined, reviewer: string): string[] {
  if (!pt) return [];
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const name = (id: string): string => titled(byId.get(id)?.title ?? id);
  const lines: string[] = [];
  for (const c of plan.contracts ?? []) {
    if (c.writer === pt.id) {
      lines.push(
        `You write the contract ${titled(c.title)} in ${c.file}, first: ${c.dependents.map(name).join(', ')} wait for it and build against it. Make it a real file in the project (types, an OpenAPI or markdown spec) with every route, shape and field spelled out, and copy the stakeholder's requirements it settles word for word from stakeholder_words.${c.summary ? ` It settles: ${c.summary}` : ''}`,
      );
    } else if (c.dependents.includes(pt.id)) {
      lines.push(`You build against the contract ${titled(c.title)} in ${c.file}, which ${name(c.writer)} wrote. Read it before you start and keep to it; if it is wrong or leaves something out, report that as blocked instead of working around it.`);
    }
  }
  if (pt.kind === 'integration') {
    const files = (plan.contracts ?? []).map((c) => c.file);
    lines.push(`This is an integration task: build and run everything the tasks before it made, together, and fix or report each mismatch against the contracts${files.length > 0 ? ` (${files.join(', ')})` : ''}. Say what ran and what didn't.`);
  } else if (pt.kind === 'verification') {
    lines.push(
      `This is the final check, and you didn't build the parts: you list each requirement of the stakeholder's words as pass or fail with the evidence, and fix nothing. The steps are below; a failed requirement goes back to its maker through the office, and ${reviewer} hears only if that can't settle it.`,
    );
  }
  if (pt.check) lines.push(`Its check is \`${pt.check}\`: run it yourself before you report the task done and put its result in the report's check; the office runs it again itself, and sends the task back with the output if it fails.`);
  return lines;
}

/**
 * v0.5 (SPEC-v0.5.md): a solo company's Builder gets the stakeholder's words verbatim as the goal in their first turn, as
 * one session would get the prompt, with the plan after it as advice. Quoted line by line, so nothing in them reads as
 * the office's own words; cut only past what a turn holds, with the brief file named for the rest.
 */
function soloGoalLines(ctx: SteerCtx, t: Task): string[] {
  if (ctx.state.shape !== 'solo' || seatOf({ id: t.owner }) !== 'builder' || t.followUp) return [];
  const words = ctx.state.prompt.trim();
  const shown = words.length > SOLO_GOAL_CHARS ? `${words.slice(0, SOLO_GOAL_CHARS)}…` : words;
  return [
    `Your goal is all of ${bossName(ctx)}'s request, word for word${words.length > SOLO_GOAL_CHARS ? ' (the rest of it is in the brief file)' : ''}: build all of this.`,
    '',
    ...shown.split(/\r?\n/).map((line) => `> ${line}`.trimEnd()),
    '',
    'The plan below is advice on how to go about it, not a ceiling.',
    '',
  ];
}
/** The most of the request a turn quotes; the brief file holds it whole. */
const SOLO_GOAL_CHARS = 48_000;

/** The assignment a plan task's owner gets when its turn comes. */
function planAssignment(ctx: SteerCtx, t: Task, v: PlanVersion): Message {
  const ms = v.plan.milestones.find((m) => m.id === t.milestone);
  const owner = personById(ctx.people, t.owner);
  const manager = owner?.level === 'worker' ? '' : ` You may split it into parts with assign: name ${t.id} as the parent and keep each part inside its files.`;
  const reviewer = t.askedBy === STAKEHOLDER ? bossName(ctx) : called(ctx, t.askedBy);
  return ctx.newMessage(
    THE_OFFICE,
    t.owner,
    [
      `New task ${t.id}, from the plan: ${t.title}`,
      '',
      ...soloGoalLines(ctx, t),
      ...briefLines(t).slice(0, -1),
      ...contractLines(v.plan, v.plan.tasks.find((x) => x.id === t.planTask), reviewer),
      `It's in the milestone ${ms ? titled(ms.title) : 'of the plan'} of the plan ${bossName(ctx)} approved (version ${v.version}).${manager}`,
      `Report to ${reviewer} when it's done${t.askedBy === STAKEHOLDER ? '' : '; they review it'}. Report with report when it's done or blocked.`,
    ].join('\n'),
  );
}

/**
 * Plan tasks whose turn has come, in priority order: in the approved part of the plan, not paused, everything they
 * wait for done (or dropped), and their files free of work under way. Each is handed to its owner (or waits for the
 * stakeholder's start when the owner checks first).
 */
export function handOutsDue(ctx: SteerCtx): Step[] {
  const scope = approvedScope({ versions: ctx.steering.versions, approved: ctx.steering.approved });
  if (!scope) return [];
  const notYet = waitingPlanTasks(ctx);
  const notYetIds = new Set(notYet.map((t) => t.id));
  const steps: Step[] = [];
  for (const t of priorityOrder(notYet)) {
    if (t.paused || !personById(ctx.people, t.owner)) continue;
    const pt = scope.version.plan.tasks.find((x) => x.id === t.planTask);
    if (!pt || !scope.milestones.has(pt.milestone)) continue;
    if (stillWaitsFor(ctx, scope.version.plan, pt).length > 0) continue;
    const except = new Set([...notYetIds, t.id]);
    for (const x of ctx.state.tasks) if (planRoot(ctx, x)?.id === t.id) except.add(x.id);
    if (fileHolder(ctx, t.files, except)) continue;
    steps.push(...handOut(ctx, t, planAssignment(ctx, t, scope.version)));
  }
  return steps;
}

/** At a milestone: the approved part is done and more of the plan waits, so the stakeholder approves the next part. */
export function holdDue(ctx: SteerCtx): Step[] {
  if (!planGoverns(ctx.steering.settings) || ctx.steering.waiting) return [];
  const scope = approvedScope({ versions: ctx.steering.versions, approved: ctx.steering.approved });
  if (!scope || scope.approval.through === null) return [];
  const plan = scope.version.plan;
  const at = plan.milestones.findIndex((m) => m.id === scope.approval.through);
  const next = plan.milestones[at + 1];
  if (at < 0 || !next) return [];
  const inScope = plan.tasks.filter((pt) => scope.milestones.has(pt.milestone));
  const over = inScope.every((pt) => {
    const id = own(ctx.steering.planTasks, pt.id);
    const t = id === undefined ? undefined : ctx.state.tasks.find((x) => x.id === id);
    return t !== undefined && (t.status === 'done' || t.status === 'dropped');
  });
  if (inScope.length === 0 || !over) return [];
  const done = plan.milestones[at];
  const events: SteerEvent[] = [{ type: 'plan-waiting', waiting: { milestone: scope.approval.through, since: ctx.now, report: null } }];
  const effects: SteerEffect[] = [];
  const ceo = ceoOf(ctx);
  if (ceo) {
    const m = ctx.newMessage(
      THE_OFFICE,
      ceo.id,
      `${done ? titled(done.title) : 'The approved milestone'} is done: every task of the plan up to it is finished. Report to ${bossName(ctx)} with report (outcome progress): what got done, what ${titled(next.title)} needs next, and anything to decide. The next milestone starts once ${bossName(ctx)} approves it.`,
    );
    events.push({ type: 'message', message: m });
    effects.push({ kind: 'deliver', message: m.id });
  }
  return [step(events, effects)];
}

/** The CEO's report while a milestone waits is the one the stakeholder reads with it. */
export function onReport(ctx: SteerCtx, report: Report): SteerEvent[] {
  const waiting = ctx.steering.waiting;
  if (!waiting || waiting.report !== null || report.to !== STAKEHOLDER || personById(ctx.people, report.person)?.level !== 'ceo') return [];
  return [{ type: 'plan-waiting', waiting: { ...waiting, report: report.id } }];
}

/** Gates whose question can't be answered usefully any more: their task is over, or its turn went to someone else. */
function staleGates(ctx: SteerCtx): Step[] {
  const events: SteerEvent[] = [];
  for (const [messageId, questionId] of Object.entries(ctx.steering.gates)) {
    const m = ctx.state.messages.find((x) => x.id === messageId);
    const taskId = own(ctx.state.assignments, messageId) ?? own(ctx.steering.taskTurns, messageId);
    const t = taskId === undefined ? undefined : ctx.state.tasks.find((x) => x.id === taskId);
    const q = ctx.state.questions.find((x) => x.id === questionId);
    const stale = !m || m.deliveredAt !== null || !t || !isOpenTask(t) || t.owner !== m.to || !q || q.withdrawn !== null;
    if (!stale) continue;
    if (q && q.withdrawn === null && q.answer === null) events.push({ type: 'withdrawn', id: q.id, reason: t && isOpenTask(t) ? `${capital(called(ctx, t.owner))} has the task now.` : 'The task is over.', at: ctx.now });
    events.push({ type: 'gate', message: messageId, question: null });
  }
  for (const [questionId] of Object.entries(ctx.steering.confirms)) {
    const q = ctx.state.questions.find((x) => x.id === questionId);
    if (!q || q.withdrawn !== null) events.push({ type: 'confirm', question: questionId, confirm: null });
  }
  return events.length > 0 ? [step(events)] : [];
}

/**
 * What steering does by itself after a change, worked out from the state alone so it is the same after a restart:
 * plan tasks whose turn came, the hold at a milestone, gates that went stale and saves whose owners heard to stop.
 * The company runs it after every change; running it again with nothing new does nothing (the company runs each save
 * once).
 */
export function settle(ctx: SteerCtx): Step[] {
  const steps = [...handOutsDue(ctx), ...holdDue(ctx), ...staleGates(ctx)];
  const saves = savesDue(ctx);
  if (saves.length > 0) steps.push(step([], saves.map((save): SteerEffect => ({ kind: 'save', save }))));
  return steps;
}

// ---------------------------------------------------------------------------------------------------------------
// While the plan governs

/**
 * Approved work: a task made from the plan, one the stakeholder put on the board themself, or a part of either. A task
 * the CEO put on the board on the stakeholder's word isn't: they asked for the task, not for its work to start before
 * the plan is approved.
 */
function approvedWork(ctx: Pick<SteerCtx, 'state' | 'steering'>, t: Task): boolean {
  const seen = new Set<string>();
  for (let at: Task | undefined = t; at && !seen.has(at.id); at = at.parent === null ? undefined : ctx.state.tasks.find((x) => x.id === at?.parent)) {
    seen.add(at.id);
    if (at.planTask && own(ctx.steering.planTasks, at.planTask) === at.id) return true;
    if (at.parent === null && at.askedBy === STAKEHOLDER) return !madeOnWord(ctx, at);
  }
  return false;
}

/**
 * Whether someone made the task on the stakeholder's word: it cites that word from its making, a message from before
 * the task. The stakeholder's own tasks start with no cites, and whoever steers one later on the stakeholder's word
 * cites words newer than the task (stakeholderWord wants words newer than its last change), so those stay theirs. A
 * first cite whose message is gone counts as a word: fail closed.
 */
function madeOnWord(ctx: Pick<SteerCtx, 'state'>, t: Task): boolean {
  const first = t.cites?.[0];
  if (first === undefined) return false;
  const m = ctx.state.messages.find((x) => x.id === first);
  return m === undefined || m.at <= t.createdAt;
}

/**
 * The limit on assign while a plan governs: a part of an approved open task whose turn has come, inside its files.
 * Anything else is refused with a sentence that says what to do instead. With approval off, managers assign freely.
 */
export function assignCheck(ctx: SteerCtx, by: string, input: Pick<AssignInput, 'parent' | 'files'>): void {
  if (!planGoverns(ctx.steering.settings)) return;
  const boss = bossName(ctx);
  const isCeo = personById(ctx.people, by)?.level === 'ceo';
  // A task the stakeholder put on the board themself is approved work from the start, so it can be split before any
  // plan is approved; one the CEO made on their word waits for the plan like any other work.
  const named = typeof input.parent === 'string' ? ctx.state.tasks.find((t) => t.id === input.parent) : undefined;
  if (!(named && approvedWork(ctx, named)) && !approvedScope({ versions: ctx.steering.versions, approved: ctx.steering.approved })) {
    throw new OrgRefusal(
      'not-allowed',
      `Work starts from the plan here: ${isCeo ? 'propose it with propose_plan' : 'the CEO proposes it'}, and once ${boss} approves it, its tasks reach their owners. Until then nobody assigns work.`,
    );
  }
  if (input.parent === null || input.parent === undefined) {
    throw new OrgRefusal(
      'not-allowed',
      `While the plan governs, assign only parts of approved tasks: name the task it belongs to as parent, and keep to that task's files. Work the plan doesn't have goes to the CEO, who can add it in a new version.`,
    );
  }
  const parent = ctx.state.tasks.find((t) => t.id === input.parent);
  if (!parent) throw new OrgRefusal('unknown', `There's no task ${oneLine(String(input.parent), 40)}.`);
  if (!isOpenTask(parent)) throw new OrgRefusal('closed', `Task ${parent.id} is ${parent.status}, so it takes no more parts.`);
  if (!approvedWork(ctx, parent)) {
    throw new OrgRefusal('not-allowed', `Task ${parent.id} isn't part of the approved plan, so it can't be split; ask the CEO to add the work to the plan.`);
  }
  if (parent.paused) throw new OrgRefusal('closed', `Task ${parent.id} is paused; it takes parts again once it resumes.`);
  const root = planRoot(ctx, parent);
  if (root && waitingPlanTasks(ctx).some((t) => t.id === root.id)) {
    const scope = approvedScope({ versions: ctx.steering.versions, approved: ctx.steering.approved });
    const pt = scope?.version.plan.tasks.find((x) => x.id === root.planTask);
    const waits = pt && scope ? stillWaitsFor(ctx, scope.version.plan, pt) : [];
    throw new OrgRefusal(
      'closed',
      waits.length > 0
        ? `Task ${root.id} waits for ${waits.map((w) => titled(w.title)).join(' and ')} first, so its parts can't start yet.`
        : `Task ${root.id} hasn't reached ${called(ctx, root.owner)} yet, so its parts can't start yet.`,
    );
  }
  const files = (Array.isArray(input.files) ? input.files : []).filter((f): f is string => typeof f === 'string').map(normalizePlanPath);
  const outside = files.find((f) => !parent.files.some((p) => pathInside(f, p)));
  if (outside !== undefined) {
    throw new OrgRefusal(
      'not-allowed',
      parent.files.length === 0
        ? `Task ${parent.id} names no files, so its parts can't change any; ask the CEO to change the plan.`
        : `${outside} isn't inside the files of task ${parent.id} (${parent.files.join(', ')}), so it can't be part of it; keep to its files, or ask the CEO to change the plan.`,
    );
  }
}

/**
 * Open tasks whose files don't count against a new part of `parent`: plan tasks not handed out yet that wait, through
 * the plan, for the plan task the part belongs to. They run only after it, so sharing files with it is the plan's
 * order, not a clash.
 */
export function laterThan(ctx: Pick<SteerCtx, 'state' | 'steering'>, parent: string | null): Set<string> {
  const out = new Set<string>();
  const start = parent === null ? undefined : ctx.state.tasks.find((t) => t.id === parent);
  const root = start ? planRoot(ctx, start) : undefined;
  const scope = approvedScope({ versions: ctx.steering.versions, approved: ctx.steering.approved });
  if (!root?.planTask || !scope) return out;
  const closure = waitClosure(scope.version.plan);
  for (const t of waitingPlanTasks(ctx)) if (t.planTask && closure.get(t.planTask)?.has(root.planTask)) out.add(t.id);
  return out;
}

/** set_goal while a plan governs: the plan sets the goal. */
export function refuseSetGoal(ctx: Pick<SteerCtx, 'steering'>): void {
  if (planGoverns(ctx.steering.settings)) {
    throw new OrgRefusal('not-allowed', 'The plan sets the goal and its milestones here; propose a new version with propose_plan.');
  }
}

/** v0.5 (SPEC-v0.5.md): the Lead's start turn in a solo company: a short plan that advises the Builder. */
function soloStartLines(boss: string, setting: string): string[] {
  return [
    `First propose the plan with propose_plan, short: the goal; one milestone when one session could build the whole request (most jobs), with an id ("ms-1"), a title and when it is done in the stakeholder's own words; tasks: [] (the office gives the Builder one task for the whole request); and the checklist: each thing the stakeholder asked for as a short checkable sentence, their words in quote, covers ["ms-1"], with an accept where a machine can check it.`,
    "The plan is advice to the Builder, not a ceiling: the Builder works from the stakeholder's words, verbatim. Then the Reviewer looks at the running result independently, and the Builder fixes what it found. With two or more Builders, give each Builder's tasks and the contracts between their parts.",
    `${capital(boss)} approves it before work starts${setting === 'milestones' ? ', one milestone at a time' : ''}. Then you sleep until something needs you or the work is done.`,
  ];
}

/**
 * v0.4 (SPEC-v0.4.md, H5): the Lead's start turn in a harness company. The Lead plans milestones and acceptance checks;
 * the office writes the loop's tasks from them (src/core/harness-shape.ts, harnessPlan).
 */
function harnessStartLines(boss: string, setting: string): string[] {
  return [
    `First propose the plan with propose_plan, as milestones, not a task split: the goal; two to four milestones in the order they are built (one for a small job), each a slice the stakeholder could try, with an id ("ms-1"), a title and when it is done in the stakeholder's own words; tasks: [] (the office writes them); and the checklist: each thing the stakeholder asked for as a short checkable sentence, their words in quote, covers naming the milestone that builds it ("ms-1"), and an accept where a machine can check it (a walk through the app's pages, or a command).`,
    "The office turns each milestone into the loop's tasks: the Tester writes its acceptance tests first, into .worklings-shared/acceptance/<milestone>/, then the Builder builds it, and the office runs those tests when the Builder reports it done, sending failures back twice before they reach you. The Reviewer gives the final review at the end. With two or more Builders, give each Builder's tasks (owner, files of their part, milestone, after) and contracts for what their parts share; one Builder needs neither.",
    `${capital(boss)} approves it before work starts${setting === 'milestones' ? ', one milestone at a time' : ''}. Then you sleep until a milestone ends, something needs you or the work is done.`,
  ];
}

/** The CEO's start turn, when a plan governs: what to do first instead of set_goal and assign. */
export function startTurnLines(ctx: Pick<SteerCtx, 'steering' | 'state'>): string[] | null {
  const setting = ctx.steering.settings.planApproval;
  if (setting === 'off') return null;
  const boss = bossName(ctx);
  if (ctx.state.shape === 'harness') return harnessStartLines(boss, setting);
  if (ctx.state.shape === 'solo') return soloStartLines(boss, setting);
  return [
    'First propose the plan with propose_plan: the goal, its milestones (each with when it is done) and its tasks, each with an owner, the files it changes, its milestone, the tasks it waits for, a brief, when it is done and its check, the one command the office can run to see it is done (like "npm test").',
    "Plan the fewest tasks that run in parallel, each a whole feature one person finishes in one sitting, with its own tests: never one task to build a thing and another to test it, none only for the README, and never one maker's work cut by phase (\"build\", then \"polish, responsive, accessible\"): accessibility, responsive layout, print and polish are requirements of the feature, in its brief and done-when. A maker holds up to 2 tasks under Lean, 3 under Balanced and 4 under Thorough. A task that is too big is narrowed to one feature or split by feature, never by file or into build and test. You don't write the final verification task: the office adds it to a medium or large plan, and a small plan ends with your own check of the result against stakeholder_words. When 3 or more makers build parts and one's tasks wait for another's, list a contract in contracts for what they share (a real file in the repo, written first by the first task of the stream that owns it, each dependent waiting for it, the stakeholder's requirements in it word for word); a large company also adds an integration task (kind \"integration\") where several people's work meets. Over-long text is cut and a task whose brief reads another task's file waits for it, with no refusal.",
    `${capital(boss)} approves it before work starts${setting === 'milestones' ? ', one milestone at a time' : ''}; until then nobody assigns work. Once it is approved, its tasks reach their owners as their turn comes, and heads split theirs into parts with assign, naming the plan's task as parent and keeping to its files.`,
  ];
}
