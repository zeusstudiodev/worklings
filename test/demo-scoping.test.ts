// The demo's new company asks the CEO's scoping questions first (Robin, 12 Nov 2026), as a real one does with a short
// prompt: the questions wait, "Use the CEO's picks" answers them, the answers reach the CEO once they apply, and it
// drafts from them. A quick prototype gets a small org; anything more gets Plant Pal's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CompanyView, STAKEHOLDER, UNDO_MS } from '../src/core/company.ts';
import { DemoHub } from '../web/src/company/demo.ts';
import { draftState, scopingOf } from '../web/src/company/proposal/model.ts';

const NOW = Date.UTC(2026, 10, 12, 13, 30);
const FOLDER = 'C:\\Users\\you\\Projects\\tiny-ideas';

describe("the demo's new company", () => {
  let hub: DemoHub;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    hub = new DemoHub(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const view = (company: string): CompanyView => {
    const v = hub.snapshot(company)?.company;
    if (!v) throw new Error(`${company} is gone`);
    return v;
  };

  it("asks the CEO's four questions before drafting, and drafts from the picks once they apply", async () => {
    const { id } = await hub.hub().createCompany(FOLDER, 'A tool that tracks what I lend to friends.');
    expect(draftState(view(id))).toBe('drafting');
    await vi.advanceTimersByTimeAsync(4_000);
    const asking = view(id);
    expect(draftState(asking)).toBe('scoping');
    expect(scopingOf(asking)?.items.map((i) => i.question.why)).toHaveLength(4);
    // The four questions of the CEO and the office's own "How thorough?".
    expect(asking.inbox).toBe(5);
    expect(asking.log.at(-1)).toMatchObject({ kind: 'scoping', by: 'ceo' });

    await hub.actions(id).answerWithPicks();
    expect(scopingOf(view(id))?.open).toBe(0);
    await expect(hub.actions(id).answerWithPicks()).rejects.toMatchObject({ status: 409, message: 'There are no open questions from the CEO to answer with its picks.' });
    // Still scoping inside the undo window; then the answers go to the CEO in one message, and it drafts.
    expect(draftState(view(id))).toBe('scoping');
    await vi.advanceTimersByTimeAsync(UNDO_MS + 600);
    const drafting = view(id);
    expect(draftState(drafting)).toBe('drafting');
    expect(drafting.messages.filter((m) => m.from === STAKEHOLDER && m.to === 'ceo' && m.text.startsWith('Answers to your scoping questions:'))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6_000);
    const proposed = view(id);
    expect(proposed.phase).toBe('proposed');
    expect(proposed.proposal?.people).toHaveLength(15);
    expect(proposed.proposal?.sizing).toMatch(/^You want a polished App Store release/);
  });

  it('proposes a small org, the CEO and two makers, for a quick prototype', async () => {
    const { id } = await hub.hub().createCompany(FOLDER, 'A tool that tracks what I lend to friends.');
    await vi.advanceTimersByTimeAsync(4_000);
    const scope = view(id).questions.find((q) => q.text === 'How far should the first version go?');
    if (!scope) throw new Error('no scope question');
    await hub.actions(id).answer(scope.id, 0, '');
    await hub.actions(id).answerWithPicks();
    await vi.advanceTimersByTimeAsync(UNDO_MS + 600 + 6_000);
    const proposed = view(id);
    expect(proposed.proposal?.people.map((p) => [p.id, p.reportsTo])).toEqual([['ceo', null], ['frontend-engineer', 'ceo']]);
    expect(proposed.proposal?.sizing).toMatch(/^A quick prototype needs one person/);
  });
});
