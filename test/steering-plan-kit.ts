// Small plans for the steering web streams' tests (test/steering-plan-*.test.ts, test/panels-steering-board*.test.ts):
// factories in the contract's shapes (src/core/steering.ts), so a change there shows up here as a type error.
import type { CompanyView } from '../src/core/company.ts';
import { CHECKLIST_LIMITS, type ChecklistItem, type Plan, type PlanComment, type PlanMilestone, type PlanTask, type PlanVersion, type PlanView, type SteeringView } from '../src/core/steering.ts';
import { company, min, NOW } from './panels-work-kit.ts';

export function milestone(id: string, title: string, extra: Partial<PlanMilestone> = {}): PlanMilestone {
  return { id, title, doneWhen: `${title} work.`, ...extra };
}

export function planTask(id: string, title: string, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, title, owner: 'frontend-engineer', files: [], milestone: 'ms-1', after: [], brief: `Brief for ${title}.`, doneWhen: `${title} works.`, ...extra };
}

/** The café's plan: two milestones, five tasks. */
export function plan(extra: Partial<Plan> = {}): Plan {
  return {
    goal: 'Customers order ahead and pick up at the counter.',
    milestones: [milestone('ms-1', 'Menu pages live'), milestone('ms-2', 'Pickup orders work')],
    tasks: [
      planTask('p-1', 'Menu data', { owner: 'frontend-engineer', files: ['src/menu/'] }),
      planTask('p-2', 'Menu photos', { owner: 'ui-designer', files: ['public/photos/'] }),
      planTask('p-3', 'Slot picker', { owner: 'frontend-engineer', milestone: 'ms-2', files: ['src/slots/'], after: ['p-1'] }),
      planTask('p-4', 'Cart', { owner: 'frontend-engineer', milestone: 'ms-2', files: ['src/cart/'] }),
      planTask('p-5', 'Order tests', { owner: 'qa-engineer', milestone: 'ms-2', files: ['test/orders/'], after: ['p-3', 'p-4'] }),
    ],
    ...extra,
  };
}

export function version(n: number, p: Plan, extra: Partial<PlanVersion> = {}): PlanVersion {
  return { version: n, by: 'ceo', at: NOW - min(60 - n * 5), plan: p, note: null, cites: [], ...extra };
}

export function planView(versions: PlanVersion[], extra: Partial<PlanView> = {}): PlanView {
  return { versions, approved: null, comments: [], waiting: null, ...extra };
}

export function comment(id: string, on: PlanComment['on'], text: string, extra: Partial<PlanComment> = {}): PlanComment {
  return { id, at: NOW - min(5), by: '@stakeholder', version: 1, on, text, message: null, ...extra };
}

export function steering(planView: PlanView | null, extra: Partial<SteeringView> = {}): SteeringView {
  return {
    plan: planView,
    acks: [],
    decisions: [],
    settings: { planApproval: 'before-work', leash: { people: {}, rooms: {} }, effort: {} },
    people: {},
    ...extra,
  };
}

/** The café company with a plan view and the plan approval setting. */
export function companyWithPlan(view: PlanView | null, extra: Partial<CompanyView> = {}, approval: SteeringView['settings']['planApproval'] = 'before-work'): CompanyView {
  const s = steering(view);
  return company({ steering: { ...s, settings: { ...s.settings, planApproval: approval } }, ...extra });
}

/**
 * A plan as the CEO now proposes it (checkPlan's `checklist: true`): with a checklist that covers every task building a
 * part, one item per task (tasks past CHECKLIST_LIMITS.items share the items), so a test about something else proposes a
 * plan that passes. Integration and verification tasks cover nothing. A plan that already says `checklist` keeps it.
 */
export function withChecklist<T>(raw: T): T {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.hasOwn(raw, 'checklist')) return raw;
  const tasks: unknown = Reflect.get(raw, 'tasks');
  const builds = (Array.isArray(tasks) ? tasks : []).flatMap((t: unknown) => {
    if (typeof t !== 'object' || t === null) return [];
    const kind: unknown = Reflect.get(t, 'kind');
    if (kind === 'integration' || kind === 'verification') return [];
    const id: unknown = Reflect.get(t, 'id');
    const title: unknown = Reflect.get(t, 'title');
    const word = typeof id === 'string' && id.trim() ? id.trim() : typeof title === 'string' && title.trim() ? title.trim() : null;
    return word ? [{ word, title: typeof title === 'string' && title.trim() ? title.trim() : word }] : [];
  });
  const count = Math.min(builds.length, CHECKLIST_LIMITS.items);
  const checklist: ChecklistItem[] = builds.slice(0, count).map((b, i) => ({ id: `k-${i + 1}`, text: `${b.title.replace(/[.!?]+$/, '').slice(0, 180)} works as asked.`, quote: null, covers: [] }));
  builds.forEach((b, i) => checklist[i % Math.max(1, count)]?.covers.push(b.word));
  return { ...raw, checklist };
}
