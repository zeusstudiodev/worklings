// The plan that waits for the stakeholder, in everyday words (SPEC-v0.2.md, "Better by design", 7): how big the company is,
// what gets built first, how many tasks and milestones it comes to and what it should cost, so that approving it is one
// press on something they understood. Pure, with no Node APIs: the web app imports the type, the company builds it.
import type { JobEstimate } from './spending.ts';
import type { PlanVersion } from './steering.ts';
import { SIZE_RULES, type Size } from './size.ts';

export interface PlanSummary {
  /** The version it describes. */
  version: number;
  /** The whole plan in a few plain sentences, ready to show above the Approve button. */
  words: string;
  size: Size | null;
  /** The size in everyday words: "a small company: the CEO and one maker, no heads and no QA or reviewer seat". */
  sizeWords: string;
  /** People besides the CEO who will work, by who owns a task in the plan. */
  makers: number;
  tasks: number;
  milestones: number;
  /** v0.2: how many things the stakeholder asked for the plan's checklist holds; 0 without one. */
  checks: number;
  /** What starts first: up to three tasks that wait for nothing, in the plan's order, with their owner's name. */
  first: { title: string; owner: string }[];
  /** The whole job's cost and time on the clock, API-equivalent dollars; null while the office can't estimate. */
  estimate: { low: number; high: number; hoursLow: number; hoursHigh: number } | null;
}

export interface PlanSummaryInput {
  version: PlanVersion;
  people: readonly { id: string; name: string }[];
  size: Size | null;
  /** The spending plan's job estimate, counted from this plan's tasks. */
  job: Pick<JobEstimate, 'low' | 'high' | 'hours'> | null;
}

/** "$0.40", "$1.8", "$12": as many figures as the amount deserves. */
function money(n: number): string {
  if (n >= 10) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(1)}`;
  return `$${Math.max(0.01, n).toFixed(2)}`;
}

const hoursOf = (low: number, high: number): string => {
  const round = (h: number) => (h >= 2 ? String(Math.round(h)) : String(Math.max(0.1, Math.round(h * 4) / 4)));
  return low === high || round(low) === round(high) ? `${round(high)} ${round(high) === '1' ? 'hour' : 'hours'}` : `${round(low)} to ${round(high)} hours`;
};

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The list "a, b and c". */
const list = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function planSummaryOf(i: PlanSummaryInput): PlanSummary {
  const plan = i.version.plan;
  const name = (id: string) => i.people.find((p) => p.id === id)?.name ?? id;
  // The first milestone's tasks that wait for nothing; before that, any that wait for nothing.
  const open = plan.tasks.filter((t) => t.after.length === 0);
  const firstMilestone = plan.milestones[0]?.id;
  const inFirst = open.filter((t) => t.milestone === firstMilestone);
  const first = (inFirst.length > 0 ? inFirst : open.length > 0 ? open : plan.tasks).slice(0, 3).map((t) => ({ title: t.title, owner: name(t.owner) }));
  const makers = new Set(plan.tasks.map((t) => t.owner)).size;
  const estimate = i.job ? { low: i.job.low, high: i.job.high, hoursLow: i.job.hours.low, hoursHigh: i.job.hours.high } : null;
  const checks = plan.checklist?.length ?? 0;
  const sizeWords = i.size ? `a ${i.size} company: ${SIZE_RULES[i.size].summary}` : `a company of ${count(makers, 'maker')} besides the CEO`;
  const sentences = [
    `${plan.tasks.length === 0 ? 'The plan has no tasks yet.' : `${count(plan.tasks.length, 'task')} in ${count(plan.milestones.length, 'milestone')}, by ${sizeWords}.`}`,
    ...(first.length > 0 ? [`It starts with ${list(first.map((f) => `${f.title.replace(/[.!?]+$/, '')} (${f.owner})`))}.`] : []),
    ...(checks > 0 ? [`It checks ${count(checks, 'thing')} you asked for.`] : []),
    ...(estimate ? [`It should cost about ${money(estimate.low)} to ${money(estimate.high)} and take ${hoursOf(estimate.hoursLow, estimate.hoursHigh)}.`] : []),
  ];
  return { version: i.version.version, words: sentences.join(' '), size: i.size, sizeWords, makers, tasks: plan.tasks.length, milestones: plan.milestones.length, checks, first, estimate };
}
