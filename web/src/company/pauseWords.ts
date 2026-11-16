// What a paused company waits for, in the words every surface that says "it waits" uses. Most pauses end when you resume
// work; a pause for the budget ends when you raise it (v0.2's spending plan). Pure.
import type { Pause } from '../../../src/core/company.ts';

export const isBudgetPause = (pause: Pick<Pause, 'reason'> | null | undefined): boolean => pause?.reason === 'budget';

/** "you resume work", or "you raise the budget" for a pause the budget made: the end of "Waits until ...". */
export const waitsForWords = (pause: Pick<Pause, 'reason'> | null | undefined): string => (isBudgetPause(pause) ? 'you raise the budget' : 'you resume work');
