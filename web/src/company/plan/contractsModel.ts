// What a plan says about how its parts fit (v0.2): the contracts it agrees first, and the kind of task that integrates or
// checks. Pure, for the plan view, the task board and tests.
import type { CompanyView } from '../../../../src/core/company.ts';
import { clip, plainText } from '../../../../src/core/now.ts';
import type { Plan, PlanContract, PlanTaskKind } from '../../../../src/core/steering.ts';
import { capital } from '../../../../src/core/words.ts';
import { nameOf } from '../people/peopleModel.ts';

/** The tag a task of that kind carries, and what it means in a line for the tag's tooltip and the card's description. */
export const KIND_WORDS: Record<PlanTaskKind, { label: string; means: string }> = {
  integration: { label: 'Integration', means: 'Builds and runs the whole milestone together and checks it against the contracts.' },
  verification: { label: 'Check', means: "Checks the finished work against your own words, by someone who didn't build it." },
};

/** The kind of a task, or null for an ordinary one or an unknown word from a newer office. */
export const kindWords = (kind: string | undefined): (typeof KIND_WORDS)[PlanTaskKind] | null => (kind !== undefined && Object.hasOwn(KIND_WORDS, kind) ? KIND_WORDS[kind as PlanTaskKind] : null);

/** The kind of the plan task a board task came from, found in the newest version that has it. */
export function kindOfTask(company: Pick<CompanyView, 'steering'>, task: { planTask?: string | null }): (typeof KIND_WORDS)[PlanTaskKind] | null {
  if (!task.planTask) return null;
  const versions = company.steering?.plan?.versions ?? [];
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const found = versions[i]?.plan.tasks.find((t) => t.id === task.planTask);
    if (found) return kindWords(found.kind);
  }
  return null;
}

export interface ContractView {
  id: string;
  title: string;
  file: string;
  /** The task that writes it, and who owns it; `missing` when the task is no longer in the plan. */
  writer: { title: string; owner: string | null; missing: boolean };
  /** The tasks that build against it, by title. */
  dependents: string[];
  summary: string | null;
}

const NOT_IN_PLAN = 'a task that is no longer in the plan';

export function contractViews(company: Pick<CompanyView, 'people'>, plan: Plan): ContractView[] {
  return (plan.contracts ?? []).map((c: PlanContract): ContractView => {
    const writer = plan.tasks.find((t) => t.id === c.writer);
    const owner = writer ? capital(nameOf(company, writer.owner).introduced) : null;
    return {
      id: c.id,
      title: plainText(c.title),
      file: c.file,
      writer: { title: writer ? plainText(writer.title) : NOT_IN_PLAN, owner, missing: writer === undefined },
      dependents: c.dependents.map((id) => plainText(plan.tasks.find((t) => t.id === id)?.title ?? NOT_IN_PLAN)),
      summary: c.summary ? clip(plainText(c.summary), 600) : null,
    };
  });
}

/** "Two contracts: interfaces the plan agrees first." for the section's note, with the count. */
export const contractsNote = (n: number): string =>
  `${n === 1 ? 'One interface is' : `${n} interfaces are`} agreed first, each in a file of the project. One task writes it, and the tasks that build against it wait for that task.`;
