import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CompanyView, type Message, STAKEHOLDER, THE_OFFICE, UNDO_MS } from '../src/core/company.ts';
import { isOpenTask } from '../src/core/company-state.ts';
import { demoCompanyView, demoFired, demoPausedView, demoUndos } from '../src/core/demo-company.ts';
import { checkPlan } from '../src/core/plan.ts';
import { DECISION_KINDS, type Decision, type Plan, type PlanTask, type SteeringView } from '../src/core/steering.ts';
import { DemoHub, demoSteering } from '../web/src/company/demo.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);

function steeringOf(view: CompanyView): SteeringView {
  if (!view.steering) throw new Error(`${view.id} has no steering`);
  return view.steering;
}

/** What changed between two plans, by id: the diff the plan's screen shows. */
function diff(before: Plan, after: Plan) {
  const ids = (p: Plan) => p.tasks.map((t) => t.id);
  const kept = ids(after).filter((id) => ids(before).includes(id));
  const was = ids(before).filter((id) => kept.includes(id));
  const changed = after.tasks.flatMap((t) => {
    const b = before.tasks.find((x) => x.id === t.id);
    if (!b) return [];
    const fields = (Object.keys(t) as (keyof PlanTask)[]).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(b[k]));
    return fields.length > 0 ? [{ id: t.id, fields }] : [];
  });
  // A task moved when it left the longest run of tasks that kept their order; with one move that run is all but one.
  const moved = kept.filter((id, i) => id !== was[i] && kept.filter((x) => x !== id).join() === was.filter((x) => x !== id).join());
  return {
    added: ids(after).filter((id) => !ids(before).includes(id)),
    removed: ids(before).filter((id) => !ids(after).includes(id)),
    changed,
    moved,
    milestonesAdded: after.milestones.filter((m) => !before.milestones.some((b) => b.id === m.id)).map((m) => m.id),
  };
}

describe("the demo company's steering data", () => {
  const cafe = demoCompanyView(NOW);
  const s = steeringOf(cafe);
  const people = new Set(cafe.people.map((p) => p.id));
  const fired = new Set(demoFired('demo').map((f) => f.id));
  const rooms = new Set(cafe.people.map((p) => p.room));
  const messages = new Map(cafe.messages.map((m) => [m.id, m]));
  const decisions = new Map(s.decisions.map((d) => [d.id, d]));
  const plan = s.plan;
  if (!plan) throw new Error('the café has no plan');
  const version = (n: number) => {
    const v = plan.versions.find((x) => x.version === n);
    if (!v) throw new Error(`no version ${n}`);
    return v;
  };

  it('is the same for the same moment', () => {
    expect(demoCompanyView(NOW).steering).toEqual(s);
  });

  it('keeps three plan versions whose tasks have real owners, real milestones and owners for every file', () => {
    expect(plan.versions.map((v) => [v.version, v.by])).toEqual([[1, 'ceo'], [2, STAKEHOLDER], [3, 'ceo']]);
    for (const v of plan.versions) {
      const milestones = new Set(v.plan.milestones.map((m) => m.id));
      const tasks = new Set(v.plan.tasks.map((t) => t.id));
      expect(tasks.size).toBe(v.plan.tasks.length);
      for (const t of v.plan.tasks) {
        expect(people.has(t.owner), `${t.id}'s owner`).toBe(true);
        expect(milestones.has(t.milestone), `${t.id}'s milestone`).toBe(true);
        for (const a of t.after) expect(tasks.has(a), `${t.id} waits for ${a}`).toBe(true);
      }
      const files = v.plan.tasks.flatMap((t) => t.files.map((f) => f.replace(/\/$/, '').toLowerCase()));
      for (const f of files) expect(files.filter((g) => g === f || g.startsWith(`${f}/`) || f.startsWith(`${g}/`)), f).toHaveLength(1);
    }
  });

  it("approves version 2 through a milestone, and version 3 answers your 'revise it' with a task added, cut, changed and moved", () => {
    expect(plan.approved).toMatchObject({ version: 2, through: 'ms-launch', by: STAKEHOLDER });
    expect(version(2).plan.milestones.some((m) => m.id === plan.approved?.through)).toBe(true);
    const revise = messages.get(version(3).cites[0] ?? '');
    expect(revise).toMatchObject({ from: STAKEHOLDER, to: 'ceo' });
    expect(revise?.text).toMatch(/^Revise it/);
    expect(diff(version(2).plan, version(3).plan)).toEqual({
      added: ['p-17'],
      removed: ['p-16'],
      changed: [{ id: 'p-15', fields: ['title', 'after', 'brief'] }],
      moved: ['p-14'],
      milestonesAdded: ['ms-stamps'],
    });
  });

  it('has comments on the plan, a milestone and a task, each carried to the CEO by a message', () => {
    expect(plan.comments.map((c) => c.on.kind)).toEqual(['plan', 'milestone', 'task']);
    for (const c of plan.comments) {
      const v = version(c.version);
      const on = c.on;
      if (on.kind === 'milestone') expect(v.plan.milestones.some((m) => m.id === on.id)).toBe(true);
      if (on.kind === 'task') expect(v.plan.tasks.some((t) => t.id === on.id)).toBe(true);
      expect(messages.get(c.message ?? '')).toMatchObject({ from: STAKEHOLDER, to: 'ceo' });
    }
  });

  it("makes the café's tasks from the approved plan, with the plan's owner, title and milestone", () => {
    const approved = version(2).plan;
    const made = cafe.tasks.filter((t) => t.planTask);
    expect(made.length).toBeGreaterThan(10);
    for (const t of made) {
      const p = approved.tasks.find((x) => x.id === t.planTask);
      expect(p, `${t.id} from ${t.planTask}`).toBeDefined();
      expect([t.owner, t.title, t.milestone, t.files]).toEqual([p?.owner, p?.title, p?.milestone, p?.files]);
    }
  });

  it('gives every open task its own place in line', () => {
    const open = cafe.tasks.filter(isOpenTask);
    const places = open.map((t) => t.priority);
    expect(places.every((p) => typeof p === 'number')).toBe(true);
    expect(new Set(places).size).toBe(open.length);
  });

  it('has a paused task, one cancelled onto a branch with a reason, and one handed over with a note', () => {
    expect(cafe.tasks.filter((t) => t.paused).map((t) => [t.id, t.paused?.by])).toEqual([['t-25', STAKEHOLDER]]);
    const cancelled = cafe.tasks.filter((t) => t.cancel);
    expect(cancelled.map((t) => [t.id, t.status])).toEqual([['t-18', 'dropped']]);
    expect(cancelled[0]?.cancel?.reason).toMatch(/TWINT/);
    expect(cancelled[0]?.cancel?.branch).toBe('worklings/t-18-apple-pay-at-pickup');
    const handed = cafe.tasks.filter((t) => (t.handovers ?? []).length > 0);
    expect(handed.map((t) => t.handovers?.map((h) => [h.from, h.to]))).toEqual([[['qa-engineer', 'security-reviewer']]]);
    expect(handed[0]?.owner).toBe('security-reviewer');
  });

  it('cites real messages from tasks, reports, status lines and messages (a Reconsider cites its decision)', () => {
    const cites = [
      ...cafe.tasks.flatMap((t) => t.cites ?? []),
      ...cafe.reports.flatMap((r) => r.cites ?? []),
      ...cafe.statuses.flatMap((l) => l.cites ?? []),
    ];
    expect(cafe.tasks.some((t) => (t.cites ?? []).length > 0)).toBe(true);
    expect(cafe.reports.some((r) => (r.cites ?? []).length > 0)).toBe(true);
    expect(cafe.statuses.some((l) => (l.cites ?? []).length > 0)).toBe(true);
    for (const id of cites) expect(messages.has(id), id).toBe(true);
    for (const m of cafe.messages) for (const id of m.cites ?? []) expect(messages.has(id) || decisions.has(id), `${m.id} cites ${id}`).toBe(true);
  });

  it('sends to the design room, to everyone and to a team: one copy each, naming the audience', () => {
    const groups = new Map<string, Message[]>();
    for (const m of cafe.messages) if (m.audience) groups.set(m.audience.group, [...(groups.get(m.audience.group) ?? []), m]);
    const of = (kind: string) => [...groups.values()].find((g) => g[0]?.audience?.kind === kind) ?? [];
    expect(of('room').map((m) => m.to).sort()).toEqual(cafe.people.filter((p) => p.room === 'design').map((p) => p.id).sort());
    expect(of('room')[0]?.audience?.title).toBe('the design room');
    // Everyone at the time: Elif was hired after the all-hands.
    expect(of('everyone').map((m) => m.to).sort()).toEqual(cafe.people.filter((p) => p.id !== 'accessibility-specialist').map((p) => p.id).sort());
    expect(of('team').map((m) => [m.from, m.to])).toEqual([['head-of-content', 'german-copywriter'], ['head-of-content', 'local-seo-specialist']]);
  });

  it('says how each delivered message was taken, and names people a message is for', () => {
    for (const m of cafe.messages) {
      if (m.to === STAKEHOLDER || m.from === THE_OFFICE) continue;
      expect(m.deliveredHow === null || m.deliveredHow === undefined, m.id).toBe(m.deliveredAt === null);
      for (const f of m.for ?? []) expect(people.has(f)).toBe(true);
    }
    expect(cafe.messages.filter((m) => (m.for ?? []).length > 0).map((m) => m.id)).toEqual(['m-5', 'm-19']);
  });

  it('acknowledges messages with real copies, agreeing and disagreeing', () => {
    expect(new Set(s.acks.map((a) => a.id)).size).toBe(s.acks.length);
    for (const a of s.acks) expect(messages.get(a.message)?.to, a.id).toBe(a.by);
    expect(s.acks.some((a) => !a.agree)).toBe(true);
    expect(s.acks.some((a) => a.agree)).toBe(true);
  });

  it("has a message for Mina stalled with Ada: delivered, neither passed on nor acknowledged", () => {
    const stalled = messages.get('m-19');
    expect(stalled).toMatchObject({ from: STAKEHOLDER, to: 'head-of-design', for: ['ui-designer'], deliveredHow: 'next-step' });
    expect(cafe.messages.some((m) => m.relayOf === 'm-19')).toBe(false);
    expect(s.acks.some((a) => a.message === 'm-19')).toBe(false);
    expect(NOW - (stalled?.deliveredAt ?? NOW)).toBeGreaterThan(10 * 60_000);
  });

  it('has a "check with me" person whose next task waits on the office\'s open gate question', () => {
    expect(s.people['german-copywriter']).toEqual({ leash: 'check', leashFrom: 'person', effort: null });
    const gate = cafe.questions.find((q) => q.gate);
    // The office asks, in the real company's words, and recommends neither answer.
    expect(gate).toMatchObject({
      from: THE_OFFICE,
      text: 'Lena would like to start “Order confirmation in both languages”. Start it, or hold it until you resume it?',
      options: ['Start it', 'Not now'],
      recommended: null,
      answer: null,
      withdrawn: null,
      gate: { task: 't-14' },
      taskId: 't-14',
    });
    expect(cafe.tasks.find((t) => t.id === 't-14')).toMatchObject({ owner: 'german-copywriter', status: 'queued' });
  });

  it('sets leashes per person and per room, a Trusted one among them, and effort per person', () => {
    expect(s.settings.planApproval).toBe('milestones');
    for (const id of Object.keys(s.settings.leash.people)) expect(people.has(id)).toBe(true);
    for (const id of Object.keys(s.settings.leash.rooms)) expect(rooms.has(id)).toBe(true);
    expect(Object.keys(s.people).sort()).toEqual([...people].sort());
    expect(s.people['frontend-engineer']).toEqual({ leash: 'trusted', leashFrom: 'room', effort: null });
    // A person's own setting wins over their room's.
    expect(s.people['security-reviewer']).toEqual({ leash: 'default', leashFrom: 'person', effort: null });
    expect(s.people['twint-payments-engineer']?.effort).toBe('xhigh');
    expect(s.people['ux-designer']).toEqual({ leash: 'default', leashFrom: 'company', effort: null });
  });

  it('logs a decision of every kind, with links that resolve, an undone one and a reconsidered one', () => {
    expect(new Set(s.decisions.map((d) => d.kind))).toEqual(new Set(DECISION_KINDS));
    expect(decisions.size).toBe(s.decisions.length);
    const questions = new Set(cafe.questions.map((q) => q.id));
    const approvals = new Set(cafe.approvals.map((a) => a.id));
    const tasks = new Set(cafe.tasks.map((t) => t.id));
    for (const d of s.decisions) {
      expect(d.people[0], d.id).toBe(d.by);
      for (const p of d.people) expect(p === STAKEHOLDER || people.has(p) || fired.has(p), `${d.id}: ${p}`).toBe(true);
      for (const r of d.rooms) expect(rooms.has(r), `${d.id}: ${r}`).toBe(true);
      const l = d.links;
      if (l.message) expect(messages.has(l.message), d.id).toBe(true);
      if (l.task) expect(tasks.has(l.task), d.id).toBe(true);
      if (l.question) expect(questions.has(l.question), d.id).toBe(true);
      if (l.approval) expect(approvals.has(l.approval), d.id).toBe(true);
      if (l.planVersion) expect(plan.versions.some((v) => v.version === l.planVersion), d.id).toBe(true);
      if (l.decision) expect(decisions.has(l.decision), d.id).toBe(true);
    }
    const undone = s.decisions.filter((d) => d.undone);
    expect(undone).toHaveLength(1);
    expect(decisions.get(undone[0]?.undone?.decision ?? '')).toMatchObject({ kind: 'undo', links: { decision: undone[0]?.id } });
    const reconsidered = s.decisions.filter((d) => d.reconsider);
    expect(reconsidered).toHaveLength(1);
    expect(messages.get(reconsidered[0]?.reconsider?.message ?? '')).toMatchObject({ from: STAKEHOLDER, to: reconsidered[0]?.by, cites: [reconsidered[0]?.id] });
  });

  it('knows how to undo every decision it calls reversible', () => {
    const undos = demoUndos('demo');
    const reversible = s.decisions.filter((d) => d.reversible).map((d) => d.id);
    expect(reversible.length).toBeGreaterThan(4);
    expect(Object.keys(undos).sort()).toEqual([...reversible].sort());
  });

  it("has Ledger's first milestone done and the next two approved, with the last held in the plan", () => {
    const ledger = demoPausedView(NOW);
    const p = steeringOf(ledger).plan;
    expect(p?.approved?.through).toBe('lms-reports');
    expect(p?.waiting).toBeNull();
    expect(ledger.goal?.milestones.find((m) => m.id === 'lms-read')?.doneAt).not.toBeNull();
    expect(ledger.reports.map((r) => r.id)).toContain('lr-1');
  });
});

describe('the demo steering actions', () => {
  let hub: DemoHub;
  const view = (): CompanyView => {
    const v = hub.snapshot('demo')?.company;
    if (!v) throw new Error('the café is gone');
    return v;
  };
  const steering = () => steeringOf(view());
  const lastDecision = (): Decision | undefined => steering().decisions.at(-1);
  const steer = () => demoSteering('demo', hub);

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    hub = new DemoHub(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a plan task without a brief as the office does: the same check, so it saves', async () => {
    const latest = steering().plan?.versions.at(-1);
    if (!latest) throw new Error('no plan');
    const plan = structuredClone(latest.plan);
    plan.tasks = plan.tasks.map((t) => (t.id === 'p-17' ? { ...t, brief: '' } : t));
    // The live company runs checkPlan; a task with no brief passes it, and so it does here.
    expect(checkPlan(plan, view().people, { earlier: steering().plan?.versions.map((v) => v.plan) ?? [] }).ok).toBe(true);
    await expect(steer().editPlan(plan, null)).resolves.toEqual({ ok: true });
    expect(steering().plan?.versions.at(-1)?.plan.tasks.find((t) => t.id === 'p-17')?.brief).toBe('');
  });

  it('hands a task over without a note, as the live company does', async () => {
    await steer().reassignTask('t-12', 'frontend-engineer', '');
    expect(view().tasks.find((t) => t.id === 't-12')).toMatchObject({ owner: 'frontend-engineer', handovers: [{ from: 'backend-engineer', to: 'frontend-engineer', note: '' }] });
  });

  it('makes an edited plan a new version, which Undo takes back with another', async () => {
    const latest = steering().plan?.versions.at(-1);
    if (!latest) throw new Error('no plan');
    const plan = structuredClone(latest.plan);
    plan.tasks = plan.tasks.map((t) => (t.id === 'p-17' ? { ...t, title: 'Stamp card on the order page' } : t));
    await expect(steer().editPlan(plan, 'A clearer name.')).resolves.toEqual({ ok: true });
    expect(steering().plan?.versions.at(-1)).toMatchObject({ version: 4, by: STAKEHOLDER, note: 'A clearer name.' });
    const edit = lastDecision();
    expect(edit).toMatchObject({ kind: 'plan', by: STAKEHOLDER, what: 'You edited the plan: version 4.', links: { planVersion: 4 }, reversible: true });
    await steer().undoDecision(edit?.id ?? '');
    expect(steering().plan?.versions.at(-1)?.plan).toEqual(latest.plan);
    expect(steering().decisions.find((d) => d.id === edit?.id)?.undone).not.toBeNull();
    expect(lastDecision()).toMatchObject({ kind: 'undo', links: { decision: edit?.id } });
  });

  it("refuses a plan the company would refuse, saying which field and why", async () => {
    const latest = steering().plan?.versions.at(-1);
    if (!latest) throw new Error('no plan');
    const plan = structuredClone(latest.plan);
    plan.tasks = plan.tasks.map((t) => (t.id === 'p-17' ? { ...t, owner: 'barista', files: ['src/pickup/Stamps.tsx'] } : t));
    const result = await steer().editPlan(plan, null);
    expect(result.ok).toBe(false);
    // The office's own check (src/core/plan.ts) turns it down, in its words: it stops at the owner before the files.
    expect(result.ok ? [] : result.errors).toEqual(["“Loyalty stamp card” is for \"barista\", who isn't in the company; give it to someone who is."]);
    await expect(steer().editPlan(latest.plan, null)).resolves.toEqual({ ok: false, errors: ['Nothing changed: that is version 3 as it stands.'] });
    expect(steering().plan?.versions).toHaveLength(3);
  });

  it('says a plan task is for someone who was let go, as the live company does, rather than a stranger', async () => {
    const latest = steering().plan?.versions.at(-1);
    if (!latest) throw new Error('no plan');
    const giveStampCard = (owner: string) => {
      const plan = structuredClone(latest.plan);
      plan.tasks = plan.tasks.map((t) => (t.id === 'p-17' ? { ...t, owner } : t));
      return plan;
    };
    // Let go before the demo opened.
    const before = await steer().editPlan(giveStampCard('food-photographer'), null);
    expect(before.ok ? [] : before.errors).toEqual(['“Loyalty stamp card” is for Lou, who was let go; give it to someone in the company.']);
    // And let go here: the demo's own firing counts the same way.
    expect(await hub.actions('demo').reshape({ action: 'fire', role: 'qa-engineer' })).toMatchObject({ ok: true });
    const after = await steer().editPlan(giveStampCard('qa-engineer'), null);
    expect(after.ok ? [] : after.errors).toEqual(['“Loyalty stamp card” is for Ravi, who was let go; give it to someone in the company.']);
    expect(steering().plan?.versions).toHaveLength(3);
  });

  it('hires into a room under its head, under the CEO without one, and under whom the hire names', async () => {
    const reshape = (action: Parameters<ReturnType<typeof hub.actions>['reshape']>[0]) => hub.actions('demo').reshape(action);
    const bossOf = (person: string) => view().people.find((p) => p.id === person)?.reportsTo;
    await expect(reshape({ action: 'hire', role: 'copy-editor', department: 'content' })).resolves.toMatchObject({ ok: true });
    expect(bossOf('copy-editor')).toBe('head-of-content');
    await expect(reshape({ action: 'hire', role: 'night-owl', department: 'direction' })).resolves.toMatchObject({ ok: true });
    expect(bossOf('night-owl')).toBe('ceo');
    await expect(reshape({ action: 'hire', role: 'proofreader', department: 'content', reportsTo: 'ceo' })).resolves.toMatchObject({ ok: true });
    expect(bossOf('proofreader')).toBe('ceo');
    for (const reportsTo of ['nobody', 'copy-editor', 'social-media-manager']) {
      const refused = await reshape({ action: 'hire', role: `r-${reportsTo}`, department: 'content', reportsTo });
      expect(refused.ok).toBe(false);
    }
  });

  it('approves the latest version through a milestone: the goal and the board follow it', async () => {
    await expect(steer().approvePlan(2, 'ms-launch')).rejects.toMatchObject({ status: 409, message: "Version 2 isn't the latest: version 3 is. Approve that one, or edit it." });
    await expect(steer().approvePlan(3, 'ms-moon')).rejects.toMatchObject({ status: 400, message: 'The plan has no milestone “ms-moon”.' });
    await steer().approvePlan(3, 'ms-stamps');
    expect(steering().plan?.approved).toMatchObject({ version: 3, through: 'ms-stamps', by: STAKEHOLDER });
    expect(view().goal?.milestones.map((m) => m.id)).toEqual(['ms-menu', 'ms-pickup', 'ms-launch', 'ms-stamps']);
    const place = (id: string) => view().tasks.find((t) => t.id === id)?.priority ?? 0;
    // Version 3 puts deploy previews first in the launch.
    expect(place('t-34')).toBeLessThan(place('t-30'));
    expect(place('t-34')).toBeLessThan(place('t-31'));
    expect(lastDecision()).toMatchObject({ kind: 'plan', what: 'You approved version 3 of the plan through “Loyalty stamps”.', links: { planVersion: 3 } });
    await expect(steer().approvePlan(3, 'ms-stamps')).rejects.toMatchObject({ status: 409 });
  });

  it('carries a comment to the CEO as a message, which the CEO acknowledges', async () => {
    await steer().commentPlan({ kind: 'task', id: 'p-17' }, 'Ten stamps feels long; try eight.');
    const comment = steering().plan?.comments.at(-1);
    expect(comment).toMatchObject({ by: STAKEHOLDER, version: 3, on: { kind: 'task', id: 'p-17' }, text: 'Ten stamps feels long; try eight.' });
    const m = view().messages.find((x) => x.id === comment?.message);
    expect(m).toMatchObject({ from: STAKEHOLDER, to: 'ceo', text: 'On the task “Loyalty stamp card”: Ten stamps feels long; try eight.' });
    vi.advanceTimersByTime(4_000);
    expect(view().messages.find((x) => x.id === m?.id)?.deliveredHow).toBe('new-turn');
    expect(steering().acks.find((a) => a.message === m?.id)).toMatchObject({ by: 'ceo', agree: true });
    await expect(steer().commentPlan({ kind: 'milestone', id: 'ms-moon' }, 'Hm.')).rejects.toMatchObject({ status: 404 });
  });

  it('sends one copy per person to a room, a team or everyone, each naming its audience', async () => {
    const room = await steer().send({ kind: 'room', id: 'design' }, 'Lunch is on me today.', []);
    expect(room.map((m) => m.to).sort()).toEqual(['brand-designer', 'head-of-design', 'ui-designer', 'ux-designer']);
    expect(new Set(room.map((m) => m.audience?.group)).size).toBe(1);
    expect(room[0]?.audience).toMatchObject({ kind: 'room', id: 'design', title: 'the design room' });
    const team = await steer().send({ kind: 'team', head: 'web-lead' }, 'Checkout first.', []);
    expect(team.map((m) => m.to).sort()).toEqual(['backend-engineer', 'frontend-engineer', 'twint-payments-engineer', 'web-lead']);
    expect(team[0]?.audience?.title).toBe("Ines's team");
    const all = await steer().send({ kind: 'everyone' }, 'We open on Monday!', []);
    expect(all).toHaveLength(view().people.length);
    vi.advanceTimersByTime(10_000);
    const sent = new Set(all.map((m) => m.id));
    // The away person's copy waits; everyone else has it, and acknowledges it.
    const copies = view().messages.filter((m) => sent.has(m.id));
    expect(copies.filter((m) => m.deliveredAt === null).map((m) => m.to)).toEqual(['devops-engineer']);
    expect(steering().acks.filter((a) => sent.has(a.message))).toHaveLength(all.length - 1);
    await expect(steer().send({ kind: 'room', id: 'kitchen' }, 'Hi', [])).rejects.toMatchObject({ status: 409, message: 'Nobody works in the kitchen room yet.' });
    await expect(steer().send({ kind: 'team', head: 'frontend-engineer' }, 'Hi', [])).rejects.toMatchObject({ status: 400 });
    await expect(steer().send({ kind: 'person', id: 'ceo' }, '   ', [])).rejects.toMatchObject({ message: 'Say something to send.' });
  });

  it('passes a message on to the people it is for', async () => {
    const [m] = await steer().send({ kind: 'person', id: 'ceo' }, 'The logo on the receipts is blurry.', ['ui-designer']);
    vi.advanceTimersByTime(4_000);
    expect(view().messages.find((x) => x.relayOf === m?.id)).toMatchObject({ from: 'ceo', to: 'ui-designer', origin: STAKEHOLDER, for: ['ui-designer'] });
    expect(steering().acks.find((a) => a.message === m?.id)?.text).toBe('Passing it on to Mina.');
  });

  it('reminds whoever holds a stalled message, who then passes it on', async () => {
    await expect(steer().remind('m-19', 'ui-designer')).rejects.toMatchObject({ status: 409, message: "Mina hasn't had that message yet; remind whoever holds it." });
    await expect(steer().remind('m-1', 'ceo')).rejects.toMatchObject({ status: 400, message: 'Only your own messages have a trace to follow.' });
    await steer().remind('m-19', 'head-of-design');
    const reminder = view().messages.at(-1);
    expect(reminder).toMatchObject({ from: STAKEHOLDER, to: 'head-of-design', cites: ['m-19'] });
    expect(reminder?.text).toMatch(/^A reminder about my message m-19: .* Please pass it on to Mina, or tell me why not\.$/);
    vi.advanceTimersByTime(4_000);
    expect(view().messages.find((x) => x.relayOf === 'm-19')).toMatchObject({ from: 'head-of-design', to: 'ui-designer' });
    expect(steering().acks.find((a) => a.message === 'm-19')).toMatchObject({ by: 'head-of-design', agree: true });
  });

  it("escalates to the holder's manager, who makes sure it arrives", async () => {
    await expect(steer().escalate('m-5', 'ceo')).rejects.toMatchObject({ status: 409, message: 'The CEO answers to you: remind them instead.' });
    await steer().escalate('m-19', 'head-of-design');
    const up = view().messages.at(-1);
    expect(up).toMatchObject({ from: STAKEHOLDER, to: 'ceo', cites: ['m-19'] });
    expect(up?.text).toContain("It hasn't reached Mina yet.");
    vi.advanceTimersByTime(4_000);
    expect(view().messages.find((x) => x.relayOf === 'm-19')).toMatchObject({ from: 'ceo', to: 'ui-designer' });
    expect(steering().acks.find((a) => a.message === up?.id)).toMatchObject({ by: 'ceo', text: "I'll make sure it reaches Mina." });
  });

  it('reorders the board: the moved task goes first and the decision says so', async () => {
    await steer().orderTasks(['t-31']);
    const open = view().tasks.filter(isOpenTask).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    expect(open.slice(0, 3).map((t) => t.id)).toEqual(['t-31', 't-12', 't-10']);
    expect(new Set(open.map((t) => t.priority)).size).toBe(open.length);
    expect(lastDecision()).toMatchObject({ kind: 'task', what: 'You moved “German pastry descriptions” to the top of the board.', links: { task: 't-31' } });
    await expect(steer().orderTasks(['t-1'])).rejects.toMatchObject({ status: 409, message: 'Task t-1 is done, so it has no place in line.' });
  });

  it('pauses a task with "stop and wait" for its working owner, and resumes it', async () => {
    await steer().pauseTask('t-11');
    expect(view().tasks.find((t) => t.id === 't-11')?.paused).toMatchObject({ by: STAKEHOLDER });
    expect(view().people.find((p) => p.id === 'frontend-engineer')?.desk.state).toBe('stopping');
    expect(lastDecision()).toMatchObject({ kind: 'task', what: 'You paused “Pickup slot picker”.' });
    vi.advanceTimersByTime(1_500);
    expect(view().messages.at(-1)).toMatchObject({ from: THE_OFFICE, to: 'frontend-engineer', interrupt: true });
    expect(view().people.find((p) => p.id === 'frontend-engineer')?.desk.state).toBe('idle');
    await expect(steer().pauseTask('t-11')).rejects.toMatchObject({ status: 409, message: '“Pickup slot picker” is paused already.' });
    await steer().resumeTask('t-11');
    expect(view().tasks.find((t) => t.id === 't-11')?.paused).toBeNull();
    expect(view().people.find((p) => p.id === 'frontend-engineer')?.desk.state).toBe('working');
    expect(lastDecision()?.what).toBe('You resumed “Pickup slot picker”.');
  });

  it("pauses and resumes every open task of a room's people", async () => {
    await steer().pauseRoom('design');
    const design = () => view().tasks.filter((t) => isOpenTask(t) && ['head-of-design', 'ui-designer', 'ux-designer', 'brand-designer'].includes(t.owner));
    expect(design().every((t) => t.paused)).toBe(true);
    expect(lastDecision()).toMatchObject({ kind: 'task', what: 'You paused the design room: three tasks wait.', rooms: ['design'] });
    await expect(steer().pauseRoom('design')).rejects.toMatchObject({ message: 'Nothing in the design room is open to pause.' });
    await steer().resumeRoom('design');
    expect(design().some((t) => t.paused)).toBe(false);
    expect(lastDecision()?.what).toBe('You resumed the design room: four tasks go on.');
  });

  it('cancels a task onto a branch with its reason, and Undo brings it back', async () => {
    await expect(steer().cancelTask('t-24', ' ')).rejects.toMatchObject({ status: 400 });
    await steer().cancelTask('t-24', 'The café likes the colours after all');
    const t = view().tasks.find((x) => x.id === 't-24');
    expect(t).toMatchObject({ status: 'dropped', cancel: { by: STAKEHOLDER, reason: 'The café likes the colours after all', branch: 'worklings/t-24-darker-palette-across-the-site' } });
    const cancel = lastDecision();
    expect(cancel).toMatchObject({ kind: 'task', what: 'You cancelled “Darker palette across the site”: The café likes the colours after all.', reversible: true });
    await expect(steer().cancelTask('t-24', 'Again')).rejects.toMatchObject({ status: 409, message: 'Task t-24 is already dropped.' });
    await steer().undoDecision(cancel?.id ?? '');
    expect(view().tasks.find((x) => x.id === 't-24')).toMatchObject({ status: 'queued', cancel: null });
  });

  it('reassigns a task with a handover note, and the new owner hears it', async () => {
    await expect(steer().reassignTask('t-12', 'backend-engineer', 'x')).rejects.toMatchObject({ status: 409, message: 'Noah has it already.' });
    // The note is optional, as it is live: no note hands the task over all the same.
    await steer().reassignTask('t-12', 'frontend-engineer', 'Noah sketched the schema in api/orders/schema.ts.');
    expect(view().tasks.find((t) => t.id === 't-12')).toMatchObject({ owner: 'frontend-engineer', handovers: [{ from: 'backend-engineer', to: 'frontend-engineer', note: 'Noah sketched the schema in api/orders/schema.ts.' }] });
    expect(lastDecision()).toMatchObject({ kind: 'task', what: 'You handed “Order API: save pickup orders” from Noah to Kai.' });
    expect(view().messages.at(-1)).toMatchObject({ from: STAKEHOLDER, to: 'frontend-engineer' });
  });

  it("creates your own task, refusing files another open task owns, holding it for someone who checks with you", async () => {
    const input = { title: 'Receipt screen', brief: 'Show a receipt after paying.', doneWhen: 'The receipt shows the items and the total.', milestone: 'ms-pickup' };
    await expect(steer().createTask({ ...input, owner: 'frontend-engineer', files: ['src/pickup/Receipt.tsx'] })).rejects.toMatchObject({
      status: 409,
      message: 'src/pickup/Receipt.tsx already belongs to Theo\'s task "Pickup orders".',
    });
    await expect(steer().createTask({ ...input, owner: 'frontend-engineer', files: ['C:\\receipt.tsx'] })).rejects.toMatchObject({ status: 400 });
    const tom = await steer().createTask({ ...input, owner: 'local-seo-specialist', files: ['src/seo/holidays.ts'], title: 'Holiday hours on the Google profile' });
    expect(tom).toMatchObject({ owner: 'local-seo-specialist', askedBy: STAKEHOLDER, status: 'queued', files: ['src/seo/holidays.ts'] });
    expect(lastDecision()).toMatchObject({ kind: 'task', what: 'You gave Tom a new task: “Holiday hours on the Google profile”.', people: [STAKEHOLDER, 'local-seo-specialist', 'head-of-content'] });
    // Clara, Tom's head, is told.
    expect(view().messages.at(-1)).toMatchObject({ from: THE_OFFICE, to: 'head-of-content' });
    const inbox = view().inbox;
    const lena = await steer().createTask({ ...input, owner: 'german-copywriter', files: ['content/de/allergens.md'], title: 'Allergen notes in German' });
    expect(view().questions.at(-1)).toMatchObject({
      from: THE_OFFICE,
      text: `Lena would like to start “Allergen notes in German”. Start it, or hold it until you resume it?`,
      options: ['Start it', 'Not now'],
      recommended: null,
      gate: { task: lena.id },
      answer: null,
    });
    expect(view().inbox).toBe(inbox + 1);
  });

  it('lets a held task start once you say so, as a decision', async () => {
    await hub.actions('demo').answer('q-5', 0, '');
    vi.advanceTimersByTime(UNDO_MS + 600);
    const decision = steering().decisions.find((d) => d.kind === 'answer' && d.links.question === 'q-5');
    expect(decision).toMatchObject({ what: 'You let Lena start “Order confirmation in both languages”.', people: [STAKEHOLDER, 'german-copywriter'] });
    expect(view().people.find((p) => p.id === 'german-copywriter')?.status?.text).toBe('Starting “Order confirmation in both languages” next.');
    // The office asked, but it isn't anyone: it posts no status line of its own.
    expect(view().statuses.some((l) => l.person === THE_OFFICE)).toBe(false);
    expect(view().tasks.find((t) => t.id === 't-14')?.paused).toBeNull();
  });

  it('pauses a held task when you say not now, until you resume it', async () => {
    await hub.actions('demo').answer('q-5', 1, '');
    vi.advanceTimersByTime(UNDO_MS + 600);
    expect(steering().decisions.find((d) => d.kind === 'answer' && d.links.question === 'q-5')?.what).toBe('You asked Lena to wait with “Order confirmation in both languages”.');
    expect(view().tasks.find((t) => t.id === 't-14')?.paused).toMatchObject({ by: STAKEHOLDER });
    expect(view().statuses.some((l) => l.person === THE_OFFICE)).toBe(false);
  });

  it('records an Always allow as an approval and a rule, and the rule can be undone', async () => {
    await hub.actions('demo').decide('a-3', 'allow', true, null);
    vi.advanceTimersByTime(UNDO_MS + 600);
    const [approval, rule] = steering().decisions.slice(-2);
    expect(approval).toMatchObject({ kind: 'approval', what: 'You allowed Kai to push the work branch to GitHub.' });
    expect(rule).toMatchObject({ kind: 'rule', what: 'You always allowed any git push to origin: Bash(git push origin:*).', reversible: true });
    await steer().undoDecision(rule?.id ?? '');
    expect(view().settings.alwaysAllow).not.toContain('Bash(git push origin:*)');
  });

  it('undoes what can be undone, and refuses the rest', async () => {
    await steer().undoDecision('d-22');
    expect(view().settings.maxDesks).toBe(6);
    expect(steering().decisions.find((d) => d.id === 'd-22')?.undone).toMatchObject({ by: STAKEHOLDER });
    expect(lastDecision()).toMatchObject({ kind: 'undo', what: 'You undid this: You set eight desks at once.', links: { decision: 'd-22' } });
    await expect(steer().undoDecision('d-22')).rejects.toMatchObject({ status: 409, message: 'That was undone already.' });
    await expect(steer().undoDecision('d-16')).rejects.toMatchObject({ status: 409 });
    // Lena stops checking with you: her open "start?" question goes.
    await steer().undoDecision('d-15');
    expect(steering().people['german-copywriter']?.leash).toBe('default');
    expect(view().questions.find((q) => q.id === 'q-5')?.withdrawn?.reason).toBe('Lena no longer checks with you before each task.');
    // The CEO's hire of Elif, taken back.
    await steer().undoDecision('d-19');
    expect(view().people.some((p) => p.id === 'accessibility-specialist')).toBe(false);
  });

  it('sends a decision back to whoever made it, citing it', async () => {
    await expect(steer().reconsider('d-22', 'Hm')).rejects.toMatchObject({ status: 409 });
    await steer().reconsider('d-24', 'Try it on the dark menu board too.');
    const m = view().messages.at(-1);
    expect(m).toMatchObject({ from: STAKEHOLDER, to: 'ui-designer', cites: ['d-24'] });
    expect(m?.text).toBe('Please reconsider: “Text and buttons go espresso brown, #3B2A20, at 7:1 on the cream background.” Try it on the dark menu board too.');
    expect(steering().decisions.find((d) => d.id === 'd-24')?.reconsider).toMatchObject({ note: 'Try it on the dark menu board too.', message: m?.id });
    expect(lastDecision()).toMatchObject({ kind: 'reconsider', links: { decision: 'd-24', message: m?.id } });
  });

  it('changes the leash per person and per room, effort, model and plan approval, each as a decision', async () => {
    await steer().changeSettings({ leash: { person: 'frontend-engineer', leash: 'check' } });
    expect(steering().people['frontend-engineer']).toEqual({ leash: 'check', leashFrom: 'person', effort: null });
    expect(lastDecision()).toMatchObject({ kind: 'leash', what: 'You set Kai to check with you before each task.', reversible: true });
    await steer().changeSettings({ leash: { room: 'design', leash: 'trusted' } });
    expect(steering().people['ux-designer']).toMatchObject({ leash: 'trusted', leashFrom: 'room' });
    expect(lastDecision()?.what).toBe('You made the design room Trusted.');
    await steer().changeSettings({ effort: { person: 'frontend-engineer', effort: 'max' } });
    expect(steering().people['frontend-engineer']?.effort).toBe('max');
    await steer().changeSettings({ model: { person: 'frontend-engineer', model: 'opus' } });
    expect(view().people.find((p) => p.id === 'frontend-engineer')?.model).toBe('opus');
    expect(lastDecision()?.what).toBe('You moved Kai to Opus.');
    const settings = await steer().changeSettings({ planApproval: 'off' });
    expect(settings.planApproval).toBe('off');
    expect(lastDecision()).toMatchObject({ kind: 'setting', what: 'You set plan approval to “Off”.' });
    await steer().changeSettings({ removeRule: 'Bash(npm run test:*)' });
    expect(view().settings.alwaysAllow).not.toContain('Bash(npm run test:*)');
    expect(lastDecision()?.kind).toBe('rule');
    await expect(steer().changeSettings({ maxDesks: 21 })).rejects.toMatchObject({ status: 400, message: 'Desks at once is a whole number from 1 to 20.' });
    await expect(steer().changeSettings({ leash: { room: 'garage', leash: 'check' } })).rejects.toMatchObject({ status: 404 });
    await expect(steer().changeSettings({})).rejects.toMatchObject({ status: 400, message: 'Say what to change.' });
  });
});
