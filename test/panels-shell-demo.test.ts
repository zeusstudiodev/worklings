import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CompanyView, mayMessage, STAKEHOLDER, TASK_STATUSES, THE_OFFICE, UNDO_MS } from '../src/core/company.ts';
import { DEMO_LIBRARY, demoCompanies, demoCompanyView, demoFinishedView, demoLobby, demoProposalView, demoSnapshot, lobbyEntryOf, studioOf, withOverview } from '../src/core/demo-company.ts';
import { checklistProblems } from '../src/core/checklist.ts';
import { approvedVersion, latestVersion } from '../src/core/plan.ts';
import { validateStudio } from '../src/core/studio.ts';
import { answeredBy, answerIn, checkEdit, decideIn, demoDiff, officeChangeIn, recount, removeDashboardIn, reviseProposal, settle, startIn, undoIn } from '../web/src/company/demoModel.ts';
import { ActionError } from '../web/src/company/types.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);

function refusal(run: () => unknown): ActionError {
  try {
    run();
  } catch (error) {
    if (error instanceof ActionError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the demo company', () => {
  const cafe = demoCompanyView(NOW);

  it('is the same for the same moment', () => {
    expect(demoCompanyView(NOW)).toEqual(cafe);
  });

  it('is an 18-person café org: a CEO, an office manager, heads, a team lead and workers', () => {
    expect(cafe.people).toHaveLength(18);
    const levels = cafe.people.map((p) => p.level);
    expect(levels.filter((l) => l === 'ceo')).toHaveLength(1);
    expect(levels.filter((l) => l === 'head')).toHaveLength(3);
    expect(levels.filter((l) => l === 'lead')).toHaveLength(1);
    expect(cafe.people.some((p) => p.id === 'office-manager')).toBe(true);
    expect(cafe.people.map((p) => p.title)).toEqual(expect.arrayContaining(['TWINT payments engineer', 'Local SEO specialist']));
    const ids = new Set(cafe.people.map((p) => p.id));
    for (const p of cafe.people) if (p.reportsTo !== null) expect(ids.has(p.reportsTo)).toBe(true);
  });

  it('has a goal with milestones and a task in every status', () => {
    expect(cafe.goal?.milestones.map((m) => m.doneAt !== null)).toEqual([true, false, false]);
    expect(new Set(cafe.tasks.map((t) => t.status))).toEqual(new Set(TASK_STATUSES));
    for (const t of cafe.tasks) expect(cafe.people.some((p) => p.id === t.owner)).toBe(true);
  });

  it('has desks in the states the panels draw: waiting, away, failed, starting, working, idle and closed', () => {
    const states = new Set(cafe.people.map((p) => p.desk.state));
    for (const s of ['waiting', 'away', 'failed', 'starting', 'working', 'idle', 'closed'] as const) expect(states.has(s)).toBe(true);
    expect(cafe.desks).toEqual({ working: 8, waiting: 1, max: 8 });
    expect(cafe.people.find((p) => p.desk.state === 'failed')?.desk.problem).toMatch(/TWINT sandbox/);
  });

  it('has your words relayed down the org, with their origin and the notes added on the way', () => {
    const relays = cafe.messages.filter((m) => m.relayOf !== null);
    expect(relays.map((m) => [m.from, m.to, m.origin])).toEqual([
      ['ceo', 'head-of-design', STAKEHOLDER],
      ['head-of-design', 'ui-designer', STAKEHOLDER],
    ]);
    expect(relays.every((m) => m.note !== null)).toBe(true);
    // Every message a person sent follows the org's rules for who may message whom.
    for (const m of cafe.messages) {
      if (m.from === STAKEHOLDER || m.from.startsWith('@')) continue;
      expect(mayMessage(cafe.people, m.from, m.to, true), `${m.from} to ${m.to}`).toBe(true);
    }
  });

  it('has open and answered questions, approvals with and without Always allow, and the inbox counts the open ones', () => {
    const open = (x: { answer: unknown; withdrawn: unknown }) => x.answer === null && x.withdrawn === null;
    expect(cafe.questions.filter(open)).toHaveLength(3);
    expect(cafe.questions.some((q) => q.answer !== null)).toBe(true);
    expect(cafe.questions.some((q) => q.withdrawn !== null)).toBe(true);
    expect(cafe.approvals.filter(open).map((a) => a.alwaysRule === null)).toEqual([false, true]);
    // Three questions, two approvals, and the CEO's plan waiting for approval.
    expect(cafe.inbox).toBe(6);
  });

  it('carries status lines, reports, a CEO dashboard, spend that adds up and a log', () => {
    expect(cafe.people.filter((p) => p.status !== null)).toHaveLength(17);
    expect(cafe.reports.some((r) => r.to === STAKEHOLDER)).toBe(true);
    expect(cafe.dashboards[0]?.widgets.map((w) => w.kind)).toEqual(['stat', 'progress', 'bars', 'line', 'list', 'table']);
    const total = cafe.people.reduce((s, p) => s + p.cost, 0);
    expect(cafe.spend.byPerson.reduce((s, p) => s + p.all, 0)).toBeCloseTo(total, 6);
    expect(cafe.spend.hourly).toHaveLength(168);
    expect(cafe.spend.hourly.reduce((s, h) => s + h.cost, 0)).toBeCloseTo(total, 0);
    expect(cafe.log.length).toBeGreaterThan(10);
  });

  it('is drawn from a studio the studio checker accepts', () => {
    const studio = studioOf(cafe);
    const parsed = validateStudio(JSON.parse(JSON.stringify(studio)));
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    const snapshot = demoSnapshot(cafe, 'C:\\Users\\you\\Projects\\cafe-lumen', NOW);
    expect(snapshot.company).toBe(cafe);
    expect(snapshot.totals.active).toBe(8);
    expect(snapshot.agents.some((a) => a.roleId === 'frontend-engineer' && a.status === 'waiting')).toBe(true);
  });
});

describe("the demo's library", () => {
  it('knows the same roles as the library folder, so its check answers as the hub would', () => {
    expect([...DEMO_LIBRARY].sort()).toEqual(readdirSync(resolve('library', 'roles')).map((f) => f.replace(/\.md$/, '')).sort());
  });

  it("refuses an edit the hub would refuse, with the org's sentence", () => {
    const plant = demoProposalView(Date.UTC(2026, 10, 5)).proposal;
    if (!plant) throw new Error('no proposal');
    const result = checkEdit({ ...plant, people: plant.people.map((p) => (p.id === 'ui-designer' ? { ...p, library: 'illustrator' } : p)) });
    expect(result).toEqual({ ok: false, errors: ['people[3].library: "illustrator" is not a library role'] });
  });
});

describe('the demo lobby', () => {
  it('lists the café, a proposal waiting, a CEO drafting, a paused company, a finished one and one that cannot run', () => {
    const lobby = demoLobby(NOW);
    expect(lobby.companies.map((c) => [c.id, c.phase])).toEqual([
      ['demo', 'running'],
      ['plant-pal', 'proposed'],
      ['lake-wind', 'founding'],
      ['ledger', 'running'],
      ['rhine-swim', 'running'],
      ['old-site', 'stopped'],
    ]);
    // Plant Pal's proposal and its two questions, which the hub puts in the inbox too.
    expect(lobby.companies.map((c) => c.needsYou)).toEqual([6, 3, 0, 5, 0, 0]);
    expect(lobby.companies.find((c) => c.id === 'ledger')?.pause?.reason).toBe('stakeholder');
    expect(lobby.companies.find((c) => c.id === 'old-site')?.problem).toMatch(/isn't at/);
    expect(lobby.hub.working).toBe(lobby.companies.reduce((s, c) => s + c.working, 0));
  });

  it('builds each entry from the company it stands for', () => {
    for (const view of demoCompanies(NOW)) {
      const entry = lobbyEntryOf(view, 'C:\\x');
      expect(entry.needsYou).toBe(view.inbox);
      expect(entry.people).toHaveLength(view.people.length);
      // With their names, as the real company gives them, so a row's latest line says whose it is.
      expect(entry.people.map((p) => p.name)).toEqual(view.people.map((p) => p.name));
    }
  });
});

describe("the demo's overview (v0.2)", () => {
  it("gives every company that can run its lobby summary, the stage in a word, and none to the one that can't", () => {
    const lobby = demoLobby(NOW);
    const stage = Object.fromEntries(lobby.companies.map((c) => [c.id, c.summary?.stage ?? null]));
    expect(stage).toEqual({ demo: 'waiting', 'plant-pal': 'waiting', 'lake-wind': 'scoping', ledger: 'paused', 'rhine-swim': 'done', 'old-site': null });
    const cafe = lobby.companies.find((c) => c.id === 'demo')?.summary;
    expect(cafe?.goal).toBe('A bilingual website for Café Lumen in Basel where guests order coffee and pastries for pickup and pay with TWINT.');
    expect(cafe?.milestones).toEqual({ done: 1, planned: 3 });
    expect(cafe?.spend.budget).toBe(60);
    expect(cafe?.needs.count).toBe(6);
    // Every summary is words for people: no ids or paths.
    for (const c of lobby.companies) for (const a of c.summary?.achieved ?? []) expect(a.title).not.toMatch(/\bt-\d|[\\/]/);
  });

  it("gives the café's plans a checklist the linter takes: every item covered, every task covering one", () => {
    const view = demoCompanyView(NOW);
    for (const v of view.steering?.plan?.versions ?? []) {
      const problems: string[] = [];
      checklistProblems(v.plan.checklist ?? [], v.plan.tasks, (i) => v.plan.tasks[i]?.title ?? '', (p) => p && problems.push(p));
      expect(problems).toEqual([]);
    }
    // The approved version's checklist, nothing marked yet, and what happened in the three hours since Alex looked.
    expect(view.checklist?.version).toBe(2);
    expect(view.checklist?.counts.unchecked).toBe(view.checklist?.rows.length);
    expect(view.looked).toEqual({ last: NOW - 3 * 3_600_000, previous: NOW - 26 * 3_600_000 });
    expect(view.since?.since).toBe(NOW - 3 * 3_600_000);
    expect(view.since?.finishedCount).toBeGreaterThan(0);
  });

  it('has a finished company: done, its checklist marked five met and one partly with evidence, and the CEO’s handover', () => {
    const view = demoFinishedView(NOW);
    expect(view.done).not.toBeNull();
    expect(view.tasks.every((t) => t.status === 'done')).toBe(true);
    expect(view.checklist?.counts).toEqual({ met: 5, partly: 1, 'not-met': 0, unchecked: 0 });
    expect(view.checklist?.rows.every((r) => r.verdict?.evidence.note)).toBe(true);
    expect(view.reports.some((r) => r.person === 'ceo' && r.taskId === null && r.outcome === 'done' && r.at >= (view.done ?? 0))).toBe(true);
    expect(view.preview.url).toBeNull();
    const plan = view.steering?.plan;
    const shown = plan ? (approvedVersion(plan) ?? latestVersion(plan)) : null;
    const problems: string[] = [];
    checklistProblems(shown?.plan.checklist ?? [], shown?.plan.tasks ?? [], () => '', (p) => p && problems.push(p));
    expect(problems).toEqual([]);
  });

  it('keeps the verdicts and works the checklist out again as the view changes', () => {
    const view = demoFinishedView(NOW);
    const later = withOverview({ ...view, tasks: view.tasks.map((t) => ({ ...t })) }, NOW + 60_000);
    expect(later.checklist?.counts).toEqual(view.checklist?.counts);
    expect(later.since?.since).toBe(view.since?.since);
  });
});

describe('the demo binding', () => {
  const cafe = demoCompanyView(NOW);
  const question = 'q-3';
  const approval = 'a-3';

  it('answers a question: the count drops at once and Undo works until the window closes', () => {
    const answered = answerIn(cafe, question, 0, '', NOW);
    expect(answered.inbox).toBe(5);
    expect(answered.questions.find((q) => q.id === question)?.answer).toMatchObject({ option: 0, text: '15-minute windows', appliesAt: NOW + UNDO_MS });
    expect(undoIn(answered, question, NOW + UNDO_MS - 1).inbox).toBe(6);
    expect(refusal(() => undoIn(answered, question, NOW + UNDO_MS)).message).toBe("It reached Mina already, so it can't be undone.");
  });

  it('refuses an empty answer and an option that is not there', () => {
    expect(refusal(() => answerIn(cafe, question, null, '  ', NOW)).message).toBe('Pick an option or write an answer.');
    expect(refusal(() => answerIn(cafe, question, 7, '', NOW)).status).toBe(400);
    expect(refusal(() => answerIn(cafe, 'q-2', 0, '', NOW)).message).toBe('It was withdrawn: Marco was handed over to you in Claude Code.');
  });

  it('allows always only where a rule is offered, and adds the rule once the window closes', () => {
    expect(refusal(() => decideIn(cafe, 'a-4', 'allow', true, null, NOW)).status).toBe(400);
    const before = new Set(answeredBy(cafe, NOW));
    expect([...before]).toEqual(['q-1', 'a-1']);
    const allowed = decideIn(cafe, approval, 'allow', true, null, NOW);
    expect(allowed.inbox).toBe(5);
    expect(settle(allowed, NOW + UNDO_MS - 1, before).done).toEqual([]);
    const { view, done } = settle(allowed, NOW + UNDO_MS, before);
    expect(done).toEqual([approval]);
    expect(view.settings.alwaysAllow).toContain('Bash(git push origin:*)');
    expect(view.people.find((p) => p.id === 'frontend-engineer')?.status?.text).toBe('Allowed: push the work branch to GitHub. Carrying on.');
    expect(settle(view, NOW + UNDO_MS, new Set([...before, ...done])).done).toEqual([]);
  });

  it("posts no status line for the office's start? once it is answered: the office isn't anyone", () => {
    const answered = answerIn(cafe, 'q-5', 0, '', NOW);
    const { view, done } = settle(answered, NOW + UNDO_MS, new Set(answeredBy(cafe, NOW)));
    expect(done).toEqual(['q-5']);
    expect(view.statuses.filter((s) => s.person === THE_OFFICE)).toEqual([]);
    expect(view.statuses).toHaveLength(answered.statuses.length);
  });

  it("never lets an answer's line cover someone's newer status line", () => {
    // Clara's question was answered 55 minutes ago; her status line from 14 minutes ago stays hers.
    const { view } = settle(cafe, NOW, new Set());
    expect(view.people.find((p) => p.id === 'head-of-content')?.status?.text).toBe('Planning the German and English menu copy.');
  });

  it('changes the office and says what changed, with the change that undoes it working too', () => {
    const themed = officeChangeIn(cafe, { change: 'theme', theme: 'arcade' }, []);
    expect(themed.message).toBe('The office is an arcade now.');
    const room = { id: 'games', title: 'Games room', kind: 'games' as const };
    const added = officeChangeIn(cafe, { change: 'add-room', room }, []);
    expect(added.view.rooms.at(-1)).toEqual(room);
    expect(refusal(() => officeChangeIn(added.view, { change: 'add-room', room }, [])).status).toBe(409);
    expect(officeChangeIn(added.view, { change: 'remove-room', room: 'games' }, []).view.rooms).toEqual(cafe.rooms);
    const decor = officeChangeIn(cafe, { change: 'decor', add: [], remove: ['plant'] }, ['plant', 'plant', 'coat-rack']);
    expect(decor.decor).toEqual(['plant', 'coat-rack']);
    expect(refusal(() => officeChangeIn(cafe, { change: 'decor', add: ['plant'], remove: [] }, Array.from({ length: 40 }, () => 'plant'))).message).toBe(
      'The office holds 40 pieces. Remove one to add another.',
    );
  });

  it("takes one of the CEO's dashboards down with a line in the log, and refuses one that is gone", () => {
    const board = cafe.dashboards[0];
    expect(board).toBeDefined();
    if (!board) return;
    const after = removeDashboardIn(cafe, board.id, NOW);
    expect(after.dashboards.map((d) => d.id)).not.toContain(board.id);
    expect(after.log.at(-1)).toEqual({ at: NOW, kind: 'dashboard', by: STAKEHOLDER, text: `You took down the dashboard “${board.title}”.` });
    expect(refusal(() => removeDashboardIn(after, board.id, NOW))).toMatchObject({ status: 404, message: "That dashboard isn't up any more." });
  });

  it('starts a proposal: everyone is hired, the CEO and the heads get to work, the inbox empties', () => {
    const plant = demoProposalView(NOW);
    const started = startIn({ ...plant, starting: true }, NOW);
    expect(started.phase).toBe('running');
    expect(started.starting).toBe(false);
    expect(started.people).toHaveLength(plant.proposal?.people.length ?? 0);
    expect(started.people.find((p) => p.level === 'ceo')?.desk.state).toBe('working');
    expect(started.people.filter((p) => p.level === 'head').every((p) => p.desk.state === 'starting')).toBe(true);
    expect(started.inbox).toBe(0);
    expect(refusal(() => startIn(started, NOW)).status).toBe(409);
  });

  it("revises the proposal from three things you can tell the demo's CEO, each still checking out", () => {
    const plant = demoProposalView(NOW).proposal;
    if (!plant) throw new Error('no proposal');
    for (const said of ['Add a German copywriter', 'Merge design and UX', 'Fewer people']) {
      const revised = reviseProposal(plant, said);
      expect(revised, said).not.toBeNull();
      if (revised) expect(checkEdit(revised.proposal), said).toEqual({ ok: true });
    }
    expect(reviseProposal(plant, 'Make it purple')).toBeNull();
  });

  it('keeps the counts true after any change', () => {
    const odd: CompanyView = { ...cafe, inbox: 99, desks: { working: 0, waiting: 0, max: 3 } };
    expect(recount(odd)).toMatchObject({ inbox: 6, desks: { working: 8, waiting: 1, max: 8 } });
  });

  it('makes up a diff shaped like git’s for a finished task', () => {
    const diff = demoDiff(['src/pickup/Status.tsx'], '7a8b9c0');
    expect(diff.split('\n').slice(0, 5)).toEqual([
      'diff --git a/src/pickup/Status.tsx b/src/pickup/Status.tsx',
      'index 7a8b9c0..ffffff1 100644',
      '--- a/src/pickup/Status.tsx',
      '+++ b/src/pickup/Status.tsx',
      '@@ -1,6 +1,12 @@',
    ]);
  });
});
