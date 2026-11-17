// v0.8 (SPEC-v0.8.md, decision 2): the inbox card's order, its count line, and the calm office's labels.
import { describe, expect, it } from 'vitest';
import type { Approval, Question } from '../src/core/company.ts';
import { cardCountLine, cardOrder } from '../web/src/company/inbox/cardModel.ts';
import type { Item } from '../web/src/company/inbox/inboxModel.ts';
import { happensNow, roomsAtWork } from '../web/src/scene/officeLabels.ts';

const approval = (id: string): Item => ({ kind: 'approval', approval: { id } as Approval });
const question = (id: string): Item => ({ kind: 'question', question: { id } as Question });

describe('the inbox card order', () => {
  const open = [question('q-1'), approval('a-2'), question('q-3')];

  it('puts the proposal or the plan first, then the open items oldest first', () => {
    expect(cardOrder({ proposal: false, plan: 'The plan waits.', open }, []).map((e) => e.key)).toEqual(['plan', 'q-1', 'a-2', 'q-3']);
    expect(cardOrder({ proposal: true, plan: null, open: [] }, []).map((e) => e.kind)).toEqual(['proposal']);
  });

  it('moves skipped items to the end, in the order they were skipped, and forgets ones that went', () => {
    const keys = cardOrder({ proposal: false, plan: null, open }, ['q-1', 'gone']).map((e) => e.key);
    expect(keys).toEqual(['a-2', 'q-3', 'q-1']);
  });

  it('says the count in a sentence', () => {
    expect(cardCountLine(1)).toBe('One needs you.');
    expect(cardCountLine(3)).toBe('Three need you.');
  });
});

describe("a company's calm office", () => {
  const member = (tone: string | null, status: string, inLine: number | null = null) => ({ bubble: tone ? { tone: tone as never } : null, status, inLine });

  it('shows bubbles only for what happens now', () => {
    expect(happensNow(member('on-it', 'working'))).toBe(true);
    expect(happensNow(member('stuck', 'idle'))).toBe(true);
    expect(happensNow(member('on-it', 'waiting'))).toBe(false);
    expect(happensNow(member('report', 'done'))).toBe(false);
    expect(happensNow(member('needs-you', 'waiting'))).toBe(false);
    expect(happensNow(member('on-it', 'working', 2))).toBe(false);
    expect(happensNow(member(null, 'working'))).toBe(false);
  });

  it('signs only the rooms someone works in', () => {
    expect([...roomsAtWork([{ room: 'design', status: 'working' }, { room: 'content', status: 'idle' }, { room: null, status: 'working' }])]).toEqual(['design']);
  });
});
