// What the CEO may cite as the stakeholder's word: only a message the stakeholder typed to that person. The office also
// writes messages in the stakeholder's name (an answer, the note on a no, a plan comment, a Reconsider request); a
// person acting for the stakeholder can't use those as the stakeholder's say-so.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDO_MS } from '../src/core/company.ts';
import { crashCopy, type Rig, rig, STAKEHOLDER } from './company-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T13:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const PLAN = {
  goal: 'A bilingual cafe website with pickup orders.',
  milestones: [{ id: 'ms-1', title: 'Menu pages live', doneWhen: 'The menu reads well on a phone.' }],
  tasks: [{ id: 'p-1', title: 'Menu data', owner: 'frontend-engineer', files: ['src/menu'], milestone: 'ms-1', after: [], brief: 'The menu as data.', doneWhen: 'Every item is in.', check: 'npm test' }],
  note: null,
  cites: [] as string[],
};
const NEW_TASK = { title: 'Fix the footer', brief: 'It overlaps.', files: ['src/Footer.tsx'], owner: 'ui-designer', doneWhen: 'It fits.', milestone: null };

const toCeo = (r: Rig) => r.company.view().messages.filter((m) => m.from === STAKEHOLDER && m.to === 'ceo');
const later = () => vi.advanceTimersByTime(1_000);

/** The stakeholder's answer to a question the CEO asked, as the message the office wrote. */
async function answerToCeo(r: Rig): Promise<string> {
  // The CEO asks the stakeholder only once a plan is approved or plan approval is off (v0.2): take it off for the question.
  const setting = r.company.view().steering?.settings.planApproval ?? 'off';
  if (setting !== 'off') r.company.changeSettings(STAKEHOLDER, { planApproval: 'off', cites: [] });
  r.company.askStakeholder('ceo', { text: 'Which accent colour for the menu?', options: ['Teal', 'Coral'], recommended: 0, taskId: null });
  const q = r.company.view().questions.at(-1);
  r.company.answer(q?.id ?? '', { option: 0, text: '' });
  await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
  const m = toCeo(r).find((x) => x.answers === q?.id);
  expect(m).toBeDefined();
  if (setting !== 'off') r.company.changeSettings(STAKEHOLDER, { planApproval: setting, cites: [] });
  return m?.id ?? '';
}

describe('a message the office wrote in the stakeholder name is not their word', () => {
  it('the answer to a question does not approve a plan', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    const cite = await answerToCeo(r);
    r.company.proposePlan('ceo', withChecklist(PLAN));
    later();
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [cite] })).toThrow(/not something .* typed/);
    expect(r.company.view().tasks).toHaveLength(0);
  });

  it('the answer to a question does not change a setting or clear a leash', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    r.company.changeSettings(STAKEHOLDER, { leash: { person: 'ux-designer', leash: 'check' }, cites: [] });
    later();
    const cite = await answerToCeo(r);
    expect(() => r.company.changeSettings('ceo', { planApproval: 'off', cites: [cite] })).toThrow(/not something .* typed/);
    expect(() => r.company.changeSettings('ceo', { leash: { person: 'ux-designer', leash: null }, cites: [cite] })).toThrow(/not something .* typed/);
    expect(r.company.view().steering?.people['ux-designer']?.leash).toBe('check');
  });

  it('the answer to a question does not put a task on the board', async () => {
    const r = await rig({ running: true, planApproval: 'off' });
    later();
    const cite = await answerToCeo(r);
    expect(() => r.company.createTask('ceo', { ...NEW_TASK, cites: [cite] })).toThrow(/not something .* typed/);
    expect(r.company.view().tasks).toHaveLength(0);
  });

  it('the note on a denied approval, sent after a restart, does not count', async () => {
    const r = await rig({ running: true, planApproval: 'off' });
    void r.company.requestApproval('ceo', {
      tool: 'Bash',
      summary: 'Push the work branch to GitHub',
      detail: 'git push origin worklings/cafe',
      kind: 'push',
      expiresAt: Date.now() + 600_000,
      alwaysRule: { rule: 'Bash(git push origin worklings/cafe)', sentence: 'any git push of the work branch to origin' },
    });
    r.company.decide(r.company.view().approvals.at(-1)?.id ?? '', { decision: 'deny', always: false, note: 'Not today.' });
    // The office goes down inside the undo window: on restart the hook is gone, so the why arrives as a message.
    const copy = crashCopy(r.root);
    await r.company.close();
    const again = r.reopen(copy);
    try {
      await again.idle();
      const note = again.view().messages.find((m) => m.from === STAKEHOLDER && m.to === 'ceo' && m.text.startsWith('No to'));
      expect(note?.fromOffice).toBe(true);
      again.proposePlan('ceo', withChecklist(PLAN));
      expect(() => again.approvePlan('ceo', { version: 1, through: null, cites: [note?.id ?? ''] })).toThrow(/not something .* typed/);
    } finally {
      await again.close();
    }
  });

  it('a plan comment does not count', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    r.company.proposePlan('ceo', withChecklist(PLAN));
    later();
    const comment = r.company.commentPlan(STAKEHOLDER, { on: { kind: 'plan' }, text: 'Split the menu data into two tasks first.' });
    later();
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [comment.message ?? ''] })).toThrow(/not something .* typed/);
    expect(r.company.view().tasks).toHaveLength(0);
  });

  it('a Reconsider request does not count', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    const d = r.company.recordDecision('ceo', { what: 'Teal for the menu', why: 'It reads well.', alternatives: [], cites: [] });
    const m = r.company.reconsider(STAKEHOLDER, { decision: d.id, note: 'Look at coral again.' });
    later();
    expect(m.fromOffice).toBe(true);
    r.company.proposePlan('ceo', withChecklist(PLAN));
    expect(() => r.company.approvePlan('ceo', { version: 1, through: null, cites: [m.id] })).toThrow(/not something .* typed/);
  });

  it('what the stakeholder typed to the CEO still counts', async () => {
    const r = await rig({ running: true, planApproval: 'before-work' });
    r.company.proposePlan('ceo', withChecklist(PLAN));
    later();
    const said = r.company.say('ceo', 'Looks right, go ahead.', { typed: true });
    later();
    r.company.approvePlan('ceo', { version: 1, through: null, cites: [said.id] });
    expect(r.company.view().tasks.length).toBeGreaterThan(0);
  });
});
