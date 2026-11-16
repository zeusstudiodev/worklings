// JOB_BASIS (src/core/spending.ts) is calibrated on real runs: this pins the table it was calibrated on and what the whole-job
// estimate says about each of them, so a change to the basis shows which runs it stops covering.
//
// The table comes from `node scripts/accounting.ts <run> --json` (cost from the transcripts, repriced at the current prices) and
// the run's company records (people, tasks, desks). Wall time is the first to the last turn's start. Every run is all Sonnet 5.5, and all
// predate the v0.2 cuts, so the totals are what a job cost before them.
import { describe, expect, it } from 'vitest';
import { estimateJob, JOB_BASIS } from '../src/core/spending.ts';

interface Run {
  run: string;
  heads: number;
  workers: number;
  desks: number;
  tasks: number;
  /** Turns the people besides the CEO took. */
  workerTurns: number;
  wallHours: number;
  cost: number;
}

const RUNS: Run[] = [
  { run: 'demo corner-bakery', heads: 0, workers: 5, desks: 8, tasks: 11, workerTurns: 26, wallHours: 1.52, cost: 15.57 },
  { run: 'lean api B-1', heads: 0, workers: 2, desks: 5, tasks: 3, workerTurns: 8, wallHours: 0.26, cost: 2.19 },
  { run: 'lean api B-2', heads: 0, workers: 2, desks: 8, tasks: 2, workerTurns: 3, wallHours: 0.16, cost: 1.87 },
  { run: 'lean feature B-1', heads: 0, workers: 2, desks: 8, tasks: 2, workerTurns: 2, wallHours: 0.07, cost: 0.84 },
  { run: 'lean feature B-2', heads: 0, workers: 2, desks: 8, tasks: 2, workerTurns: 2, wallHours: 0.04, cost: 0.81 },
  { run: 'lean game B-1', heads: 0, workers: 2, desks: 8, tasks: 4, workerTurns: 6, wallHours: 0.23, cost: 2.45 },
  { run: 'lean game B-2', heads: 0, workers: 3, desks: 8, tasks: 4, workerTurns: 6, wallHours: 0.19, cost: 3.57 },
  { run: 'feature-b2', heads: 0, workers: 2, desks: 3, tasks: 2, workerTurns: 2, wallHours: 0.03, cost: 0.85 },
  { run: 'feature-bbig', heads: 1, workers: 6, desks: 3, tasks: 4, workerTurns: 7, wallHours: 0.05, cost: 1.78 },
  { run: 'link-checker-b', heads: 2, workers: 5, desks: 3, tasks: 6, workerTurns: 19, wallHours: 0.12, cost: 6.53 },
  { run: 'link-checker-b2', heads: 0, workers: 2, desks: 3, tasks: 2, workerTurns: 2, wallHours: 0.24, cost: 1.61 },
  { run: 'link-checker-bbig', heads: 1, workers: 6, desks: 3, tasks: 8, workerTurns: 29, wallHours: 0.52, cost: 7.81 },
  { run: 'pomodoro-b', heads: 2, workers: 6, desks: 3, tasks: 9, workerTurns: 22, wallHours: 0.29, cost: 8.02 },
  { run: 'pomodoro-b2', heads: 0, workers: 2, desks: 3, tasks: 5, workerTurns: 6, wallHours: 0.16, cost: 2.16 },
  { run: 'pomodoro-bbig', heads: 2, workers: 7, desks: 3, tasks: 9, workerTurns: 29, wallHours: 0.37, cost: 9.62 },
];

const model = 'claude-sonnet-5-5';
const team = (r: Run) => [{ level: 'ceo', model }, ...Array.from({ length: r.heads }, () => ({ level: 'head', model })), ...Array.from({ length: r.workers }, () => ({ level: 'worker', model }))];
const inside = (r: Run, tasks: number | null) => {
  const job = estimateJob({ people: team(r), maxDesks: r.desks, tasks, from: 'proposal' });
  return job !== null && r.cost >= job.low && r.cost <= job.high;
};
const missed = (tasks: boolean) => RUNS.filter((r) => !inside(r, tasks ? r.tasks : null)).map((r) => r.run);

describe('the whole-job estimate against real runs', () => {
  it('rests on a table of 15 runs that is what the basis was set from', () => {
    expect(RUNS).toHaveLength(15);
    // The basis' own claims, checked against the table: a task cost about $0.40 to $1.40 all in, and a person besides the CEO
    // had one to two and a half tasks.
    const perTask = RUNS.map((r) => r.cost / r.tasks);
    expect(Math.min(...perTask)).toBeGreaterThan(0.4);
    expect(Math.max(...perTask)).toBeLessThan(1.45);
    const perPerson = RUNS.map((r) => r.tasks / (r.heads + r.workers)).sort((a, b) => a - b);
    expect(perPerson[2]).toBeGreaterThanOrEqual(JOB_BASIS.tasksPerPerson.low); // all but the two leanest
    expect(Math.max(...perPerson)).toBeLessThanOrEqual(JOB_BASIS.tasksPerPerson.high);
  });

  it("holds the real total of 14 of the 15 runs when it counts the plan's tasks; the demo bakery runs past the top", () => {
    // 11 tasks on 8 desks and the dearest a task ($1.42, against a top of about $1.20): it finished 18% over the range.
    expect(missed(true)).toEqual(['demo corner-bakery']);
  });

  it('holds 14 of the 15 when the tasks are assumed from the team; the 8-person team that split 4 tasks stays under the bottom', () => {
    // Seven people besides the CEO had four tasks between them, 0.6 each, below the one task a person that the basis starts at.
    expect(missed(false)).toEqual(['feature-bbig']);
  });

  it('is not made to hold the runs by being wide: the top is under 5 times the bottom', () => {
    for (const r of RUNS) {
      const job = estimateJob({ people: team(r), maxDesks: r.desks, tasks: r.tasks, from: 'proposal' });
      expect((job?.high ?? 0) / (job?.low ?? 1)).toBeLessThan(5);
    }
  });

  it("says the figures come from runs before v0.2's cuts, so a job now should cost less", () => {
    const lines = estimateJob({ people: team(RUNS[1] as Run), maxDesks: 5, tasks: 3, from: 'proposal' })?.lines.join(' ') ?? '';
    expect(lines).toContain('before v0.2');
    expect(lines).toContain('come in lower');
  });
});
