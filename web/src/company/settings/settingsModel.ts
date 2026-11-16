// What Settings says about the company's Always allow rules. Pure, for tests.
import type { Approval } from '../../../../src/core/company.ts';
import { plainText } from '../../../../src/core/now.ts';

/**
 * What an Always allow rule allows, in the words the inbox promised when it offered the rule ("any git push to origin"),
 * from the newest approval that carries it. Null for a rule no approval in the view carries any more: the view keeps
 * only the latest approvals, and the settings hold the bare rules.
 */
export function ruleSentence(rule: string, approvals: readonly Pick<Approval, 'alwaysRule'>[]): string | null {
  for (let i = approvals.length - 1; i >= 0; i--) {
    const always = approvals[i]?.alwaysRule;
    if (always?.rule !== rule) continue;
    const sentence = plainText(always.sentence).trim().replace(/\.$/, '');
    if (sentence) return sentence;
  }
  return null;
}

/**
 * Whether "Remove from the lobby" is offered. The demo company looked at from your own lobby is not in it: removing it
 * would leave a notice, and an Undo that reopens a folder, in the lobby that is really yours. Only a tab that is itself
 * the demo (the static site, or one opened at the demo) may remove it.
 */
export const offersRemoval = (demoCompany: boolean, demoTab: boolean): boolean => !demoCompany || demoTab;
