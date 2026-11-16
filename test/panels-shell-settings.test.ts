// What Settings says about the company's Always allow rules (web/src/company/settings/settingsModel.ts).
import { describe, expect, it } from 'vitest';
import { ruleSentence } from '../web/src/company/settings/settingsModel.ts';
import { approval } from './panels-work-kit.ts';

const push = { rule: 'Bash(git push origin:*)', sentence: 'any git push to origin' };

describe('an Always allow rule in Settings', () => {
  it('says what it allows in the words the inbox promised', () => {
    const approvals = [approval('a1', 'frontend-engineer', 'Push the work branch to GitHub', { alwaysRule: push })];
    expect(ruleSentence('Bash(git push origin:*)', approvals)).toBe('any git push to origin');
  });

  it('takes the newest approval that carries the rule', () => {
    const approvals = [
      approval('a1', 'frontend-engineer', 'Push', { alwaysRule: { ...push, sentence: 'an older wording' } }),
      approval('a2', 'qa-engineer', 'Fetch', { alwaysRule: { rule: 'Bash(git fetch origin:*)', sentence: 'any git fetch from origin' } }),
      approval('a3', 'frontend-engineer', 'Push', { alwaysRule: push }),
    ];
    expect(ruleSentence('Bash(git push origin:*)', approvals)).toBe('any git push to origin');
    expect(ruleSentence('Bash(git fetch origin:*)', approvals)).toBe('any git fetch from origin');
  });

  it('has no words for a rule no approval in the view carries, or one whose words are empty', () => {
    expect(ruleSentence('Bash(npm run test:*)', [approval('a1', 'frontend-engineer', 'Push', { alwaysRule: push })])).toBeNull();
    expect(ruleSentence('Bash(git push origin:*)', [])).toBeNull();
    expect(ruleSentence('Bash(git push origin:*)', [approval('a1', 'frontend-engineer', 'Push', { alwaysRule: { ...push, sentence: '  ' } })])).toBeNull();
    expect(ruleSentence('Bash(git push origin:*)', [approval('a1', 'frontend-engineer', 'Push', { alwaysRule: null })])).toBeNull();
  });

  it('drops a closing full stop, since the list shows the words on their own', () => {
    expect(ruleSentence('WebFetch(domain:example.com)', [approval('a1', 'frontend-engineer', 'Read', { alwaysRule: { rule: 'WebFetch(domain:example.com)', sentence: 'reading pages on example.com.' } })])).toBe(
      'reading pages on example.com',
    );
  });
});
