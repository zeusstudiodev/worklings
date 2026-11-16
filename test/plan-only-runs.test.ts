// The five real plan-only runs of v0.2 (test/fixtures/plan-only-v02/, from scripts/plan-only.mjs: what the CEO proposed and
// what the office turned down) replayed through today's proposal and plan checks, offline. The JSON holds what was
// accepted, not the first draft or the briefs, so each plan is replayed as accepted, and the refusals the runs met
// (character limits, files named in briefs, a missing final review) are built again from their sentences. After the
// tuning each must pass with at most one refusal round, or be adjusted by the office with no round at all.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProposal } from '../src/core/org.ts';
import { checkPlan, type PlanPerson } from '../src/core/plan.ts';
import { areasOf } from '../src/core/plan-lint.ts';
import type { PresetId } from '../src/core/presets.ts';
import type { Size } from '../src/core/size.ts';

interface RunPerson { id: string; title: string; level: string; reportsTo: string | null; model: string }
interface RunTask { id: string; title: string; owner: string; files: string[]; check: string | null; after: string[]; kind: string | null; milestone: string }
interface Run {
  prompt: string;
  preset: PresetId;
  org: { size: Size; sizing: string; people: RunPerson[] };
  plan: { goal: string; milestones: { id: string; title: string }[]; tasks: RunTask[] };
  refusals: { org: { errors: string[] }[]; plan: { errors: string[] }[] };
}

const load = (n: number): Run => JSON.parse(readFileSync(resolve('test', 'fixtures', 'plan-only-v02', `${n}.json`), 'utf8')) as Run;
const RUNS = [1, 2, 3, 4, 5].map((n) => ({ n, run: load(n) }));

// --- The plan --------------------------------------------------------------------------------------------------------

const peopleOf = (run: Run): PlanPerson[] => run.org.people.map((p) => ({ id: p.id, name: p.title, title: p.title, level: p.level }));

/** The plan as a propose_plan would carry it, from what the run accepted (it keeps no briefs, so each has one line and a done-when). */
const rawPlan = (run: Run, tasks: readonly RunTask[] = run.plan.tasks) => ({
  goal: run.plan.goal,
  milestones: run.plan.milestones.map((m) => ({ ...m, doneWhen: 'It is done.' })),
  tasks: tasks.map(({ check, kind, ...t }) => ({ ...t, brief: `Do ${t.title}.`, doneWhen: `${t.title} works.`, ...(check ? { check } : {}), ...(kind ? { kind } : {}) })),
});
const replay = (run: Run, raw: unknown = rawPlan(run)) => checkPlan(raw, peopleOf(run), { structure: true, size: run.org.size, preset: run.preset });

/** The tasks that stay, each waiting only for tasks that stay: what the CEO does when told to fold tasks together. */
const keeping = (run: Run, ids: readonly string[]): RunTask[] => run.plan.tasks.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, after: t.after.filter((a) => ids.includes(a)) }));

describe('the five real plan-only runs, replayed through the plan check', () => {
  const [one, two, three, four, five] = RUNS.map((r) => r.run) as [Run, Run, Run, Run, Run];

  it('are read as the runs recorded them: sizes, presets, makers and what the CEO had to be turned down for', () => {
    expect(RUNS.map(({ run }) => [run.org.size, run.preset, run.org.people.filter((p) => p.level === 'worker').length])).toEqual([
      ['small', 'balanced', 1],
      ['small', 'balanced', 1],
      ['medium', 'balanced', 2],
      ['medium', 'lean', 2],
      ['medium', 'balanced', 3],
    ]);
    expect(RUNS.map(({ run }) => run.refusals.plan.length)).toEqual([1, 1, 2, 2, 2]);
  });

  it('1, a tiny CLI: is not "too big" for its scaffold files, and the README task is folded into the build, in one round', () => {
    // Before: its files (the root, bin, src, test and .gitignore) counted as five areas, and "split it by area" followed.
    expect(areasOf(one.plan.tasks[0]?.files ?? [])).toHaveLength(3);
    const first = replay(one);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toContain('“Write the README” (p-2) is only documentation; fold it into the task that builds what it documents');
    const second = replay(one, rawPlan(one, keeping(one, ['p-1'])));
    expect(second.ok).toBe(true);
    // A small plan has no final review of the office's.
    if (second.ok) expect(second.plan.tasks.map((t) => t.kind)).toEqual([undefined]);
  });

  it('2, a tip calculator: passes as it was accepted, at three tasks for one maker, and with no wait for areas', () => {
    expect(areasOf(two.plan.tasks[2]?.files ?? [])).toEqual(['the project root', 'src/ui', 'src/styles']);
    const result = replay(two);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.tasks).toHaveLength(3);
    expect(result.notes).toBeUndefined();
  });

  it('3, a recipe box on Balanced: nine tasks for two makers is held to six, in one answer, and the rest passes', () => {
    const first = replay(three);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    // One sentence: the count. Not "too big", no brief files, no final review: those cost the run three more rounds.
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toContain('The plan has 9 tasks, and 2 makers hold 6 (Balanced: up to 3 each)');
    const second = replay(three, rawPlan(three, keeping(three, ['p-1', 'p-3', 'p-4', 'p-5', 'p-7', 'p-9'])));
    if (!second.ok) throw new Error(second.errors.join('\n'));
    // The CEO's own final review is not among them: the office added its own, last.
    expect(second.plan.tasks.at(-1)).toMatchObject({ kind: 'verification', owner: 'ceo', milestone: 'ms-4', title: 'Final review of the whole result' });
    expect(second.plan.tasks.filter((t) => t.kind === 'verification')).toHaveLength(1);
  });

  it('4, the same app on Lean: eight tasks for two makers is held to four, so Lean no longer plans like Balanced', () => {
    const first = replay(four);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toContain('The plan has 8 tasks, and 2 makers hold 4 (Lean: up to 2 each)');
    const second = replay(four, rawPlan(four, keeping(four, ['p-1', 'p-2', 'p-3', 'p-7'])));
    expect(second.ok).toBe(true);
  });

  it('5, a team tracker with API, web and design: the CEO is asked for a contract, in the shape to add, and then passes', () => {
    const first = replay(five);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    // One sentence, and it names the backend as the stream the others build on, its first task as the writer, and who waits.
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toContain("3 people build parts of this plan and some tasks build on the backend engineer's work, but it has no contracts.");
    expect(first.errors[0]).toContain('"file":"docs/contracts/backend-engineer.md","writer":"p-1","dependents":["p-6","p-7","p-8"]');
    // With the contract in, in the files of its writer and waited for by its dependents, it passes, and the office added the final review.
    const tasks = rawPlan(five).tasks.map((t) => (t.id === 'p-1' ? { ...t, files: [...t.files, 'docs/contracts/backend-engineer.md'] } : t));
    const second = replay(five, { ...rawPlan(five), tasks, contracts: [{ title: 'Server API', file: 'docs/api.md', writer: 'p-1', dependents: ['p-6', 'p-7', 'p-8'] }] });
    if (!second.ok) throw new Error(second.errors.join('\n'));
    expect(second.plan.contracts).toHaveLength(1);
    expect(second.plan.tasks.filter((t) => t.kind === 'verification')).toHaveLength(1);
    expect(second.plan.tasks.at(-1)?.after.length).toBeGreaterThan(0);
  });

  it('2 again, with the checklist the CEO now sends: kept as sent; without one, that is the only problem, in one answer', () => {
    const listed = (raw: unknown) => checkPlan(raw, peopleOf(two), { structure: true, checklist: true, size: two.org.size, preset: two.preset });
    const builds = two.plan.tasks.filter((t) => t.kind === null);
    const checklist = builds.map((t, i) => ({ id: `k-${i + 1}`, text: `${t.title} works as asked.`, quote: null, covers: [t.id] }));
    const result = listed({ ...rawPlan(two), checklist });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.plan.checklist).toEqual(checklist);
    const bare = listed(rawPlan(two));
    expect(bare.ok ? [] : bare.errors).toEqual(['The plan has no checklist; list each thing the stakeholder asked for as a short checkable sentence, quoting their words, with the tasks that cover it.']);
  });

  it('never meets a round for what code can fix: every run is refused for its shape or not at all, in one round', () => {
    for (const { run } of RUNS) {
      const first = replay(run);
      if (first.ok) continue;
      expect(first.errors.length, run.prompt).toBeLessThanOrEqual(1);
      expect(first.errors.join(' '), run.prompt).not.toMatch(/too big for one context|brief names|verification|characters/);
    }
  });
});

// --- The org ---------------------------------------------------------------------------------------------------------

const FIRST_NAMES = ['Noor', 'Sam', 'Ivo', 'Kai', 'Lea', 'Tom'];
/** The proposal as propose_org would carry it, from the accepted org (which keeps no rooms or areas, so each person gets one). */
function rawOrg(run: Run, change: (people: Record<string, unknown>[]) => void = () => undefined) {
  const people = run.org.people.map((p, i): Record<string, unknown> => ({
    id: p.id,
    name: FIRST_NAMES[i] ?? 'Pat',
    title: p.title,
    level: p.level,
    room: p.level === 'ceo' ? 'direction' : 'engineering',
    reportsTo: p.reportsTo,
    owns: `The ${p.title.toLowerCase()}'s area.`,
    library: p.level === 'ceo' ? 'ceo' : p.id,
  }));
  change(people);
  return {
    company: 'Replay Co',
    goal: run.prompt.slice(0, 200),
    size: run.org.size,
    sizing: run.org.sizing,
    theme: 'office',
    rooms: [
      { id: 'direction', title: 'Direction', style: 'direction' },
      { id: 'engineering', title: 'Engineering', style: 'engineering' },
    ],
    people,
    questions: [],
  };
}
const knownFor = (run: Run) => ({ libraryRoles: new Set(['ceo', ...run.org.people.map((p) => p.id)]), preset: run.preset });
/** `text` over its limit, in sentences, as a CEO writes an area or a note: "<where>: up to 200 characters, got 217". */
const longSentences = (length: number): string => {
  let text = '';
  for (let i = 1; text.length < length; i += 1) text += `${text ? ' ' : ''}Part ${i} of what they own, in a sentence.`;
  return text;
};

describe('the five real plan-only runs, replayed through the proposal check', () => {
  it('pass as the CEO ended with them, sized and shaped for their preset', () => {
    for (const { run } of RUNS) {
      const result = checkProposal(rawOrg(run), knownFor(run));
      expect(result.ok, `${run.prompt}: ${result.ok ? '' : result.errors.join('; ')}`).toBe(true);
    }
  });

  it('cut the owns, notes and sentences that cost four of the five runs a full-context retry, and accept them', () => {
    // Run 2 met "notes[3]: up to 300 characters, got 332"; run 3 an owns of 217 and 227, seven notes and a note of 417; run 5 an owns of 239 and 218.
    const long = (run: Run) => checkProposal(
      rawOrg(run, (people) => {
        const second = people[1];
        if (second) {
          second.owns = longSentences(239);
          second.notes = [longSentences(100), longSentences(120), longSentences(80), longSentences(417), 'five', 'six', 'seven'];
        }
      }),
      knownFor(run),
    );
    for (const { run } of RUNS.slice(1)) {
      const result = long(run);
      if (!result.ok) throw new Error(`${run.prompt}: ${result.errors.join('; ')}`);
      const second = result.proposal.people[1];
      expect(second?.owns.length).toBeLessThanOrEqual(200);
      expect(second?.notes).toHaveLength(6);
      expect(second?.notes?.every((n) => n.length <= 300)).toBe(true);
      expect(result.notes?.length).toBe(3);
    }
  });

  it('3: the QA-style seat Balanced doesn’t allow comes back in the same answer as the rest, once, with the over-long text already cut', () => {
    const three = load(3);
    const result = checkProposal(
      rawOrg(three, (people) => {
        const extra = { ...(people[2] as Record<string, unknown>), id: 'accessibility-specialist', title: 'Accessibility specialist', name: 'Pat', library: 'accessibility-specialist', owns: longSentences(227) };
        people.push(extra);
      }),
      { libraryRoles: new Set(['ceo', ...three.org.people.map((p) => p.id), 'accessibility-specialist']), preset: three.preset },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('is a QA or reviewer seat, and Balanced has none');
  });
});
