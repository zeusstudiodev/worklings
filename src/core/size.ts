// How big a company is (v0.2, SPEC-v0.2.md "Better by design", 1): the CEO picks small, medium or large with one line
// of reason, and code holds the org (src/core/org.ts) and the plan (src/core/plan.ts) to the shape that size means.
// A flat company is the default: every management layer is a lossy relay and a paid turn. Pure, with no Node APIs.

export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

export const isSize = (value: unknown): value is Size => typeof value === 'string' && (SIZES as readonly string[]).includes(value);

export interface SizeRule {
  /** People who do the work (not the CEO, a head, a team lead or a checker seat). */
  makers: { min: number; max: number };
  /** The most tasks a CEO's plan holds at this size, however many makers there are (`taskCap` is the cap that applies). */
  maxTasks: number;
  /** The size in everyday words, for the CEO's guidance and the proposal. */
  summary: string;
}

/** The most makers a company holds: ORG_SIZE.max (25) less the CEO. */
const MOST_MAKERS = 24;

export const SIZE_RULES: Readonly<Record<Size, SizeRule>> = {
  small: { makers: { min: 1, max: 1 }, maxTasks: 4, summary: 'the CEO and one maker, no heads and no QA or reviewer seat' },
  medium: { makers: { min: 2, max: 4 }, maxTasks: 10, summary: 'a flat company: the CEO and 2 to 4 makers, no heads' },
  large: { makers: { min: 5, max: MOST_MAKERS }, maxTasks: 30, summary: 'the CEO and 5 or more makers, with heads only when more than 6 makers need briefing' },
};

/**
 * The most tasks a CEO's plan holds (the final verification, which the office adds, not counted): `perMaker` tasks for
 * each maker, at least 1, and never over the size's own cap. A plan of whole tasks parallelises as far as people do; more
 * tasks than that are slices of one task, and each is a paid turn.
 */
export const taskCap = (size: Size, makers: number, perMaker: number): number => Math.max(1, Math.min(SIZE_RULES[size].maxTasks, makers * perMaker));

/** A large company has heads only when its makers outnumber what the CEO can brief. */
export const HEADS_OVER = 6;
/** A head briefs at least this many people; fewer is a relay with nothing to relay. */
export const HEAD_BRIEFS = 3;

/** The size the people who do the work make up, for a company whose proposal declared none (older ones). */
export function sizeOfMakers(makers: number): Size {
  return makers <= SIZE_RULES.small.makers.max ? 'small' : makers <= SIZE_RULES.medium.makers.max ? 'medium' : 'large';
}

/**
 * Seats whose whole job is to check others' work: QA, testers, reviewers and accessibility specialists, by the id or
 * title a person has. They are not makers, and a company's size and preset say how many it may have.
 */
const CHECKER_SEAT = /(?:^|[\s-])(?:qa|quality|tester|reviewer|accessibility)(?:$|[\s-])/i;
export const isCheckerSeat = (p: { id: string; title: string }): boolean => CHECKER_SEAT.test(p.id) || CHECKER_SEAT.test(p.title);

/**
 * The size a running company's plan is held to: the CEO's declared size, which stands even when the stakeholder hired
 * after it, or, for proposals older than v0.2 that declared none, the size its people make up.
 */
export function companySize(people: readonly { id: string; title: string; level: string }[], declared: Size | undefined): Size {
  if (declared) return declared;
  return sizeOfMakers(people.filter((p) => p.level === 'worker' && !isCheckerSeat(p)).length);
}

/** The people who do the work among a plan's people: not the CEO, a head, a team lead or a checker seat. */
export const makersIn = (people: readonly { id: string; title: string; level?: string }[]): number =>
  people.filter((p) => p.id !== 'ceo' && (p.level === undefined || p.level === 'worker') && !isCheckerSeat(p)).length;
