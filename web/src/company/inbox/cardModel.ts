// The inbox card's order (SPEC-v0.8.md, decision 2): what the card can show, oldest first, as the inbox lists it: the
// proposal or the plan waiting for you, then the open questions and approvals. Items skipped this visit go to the end,
// in the order they were skipped. Pure, for tests.
import { countWord } from '../../../../src/core/now.ts';
import { capital } from '../../../../src/core/words.ts';
import { itemId, type Item } from './inboxModel.ts';

export type CardEntry = { kind: 'item'; key: string; item: Item } | { kind: 'proposal' | 'plan'; key: string; text: string };

export function cardOrder(input: { proposal: boolean; plan: string | null; open: readonly Item[] }, skipped: readonly string[]): CardEntry[] {
  const all: CardEntry[] = [
    ...(input.proposal ? [{ kind: 'proposal' as const, key: 'proposal', text: "The CEO's proposal is ready for you." }] : []),
    ...(input.plan ? [{ kind: 'plan' as const, key: 'plan', text: input.plan }] : []),
    ...input.open.map((item) => ({ kind: 'item' as const, key: itemId(item), item })),
  ];
  const later = new Set(skipped);
  const byKey = new Map(all.map((e) => [e.key, e]));
  return [...all.filter((e) => !later.has(e.key)), ...skipped.flatMap((k) => (byKey.has(k) ? [byKey.get(k) as CardEntry] : []))];
}

/** What the live region says when the count changes: "Three need you.", "One needs you." */
export const cardCountLine = (n: number): string => `${capital(countWord(n))} ${n === 1 ? 'needs' : 'need'} you.`;
