import { describe, expect, it } from 'vitest';
import { nameWithCount } from '../web/src/company/ui/countName.ts';
import { keepStill, markStill, parseStill, readStill, STILL_KEY, stillWords } from '../web/src/lib/stillCore.ts';
import { modelLabel } from '../web/src/scene/alt.ts';

describe('a control that shows a count', () => {
  it('starts its name with the visible text, so speaking the label finds it', () => {
    expect(nameWithCount('Inbox', 4)).toBe('Inbox 4, four need you');
    expect(nameWithCount('Inbox', 1)).toBe('Inbox 1, one needs you');
    expect(nameWithCount('Lobby', 3, ' in other companies')).toBe('Lobby 3, three need you in other companies');
  });

  it('is only the label when nothing needs anyone, and shows 99+ as the pill does', () => {
    expect(nameWithCount('Inbox', 0)).toBe('Inbox');
    expect(nameWithCount('Inbox', Number.NaN)).toBe('Inbox');
    expect(nameWithCount('Inbox', 120)).toBe('Inbox 99+, 120 need you');
  });
});

describe('the model\'s caption', () => {
  it('reads right for none, one and many', () => {
    expect(modelLabel(4, 11)).toBe('Model of the studio: 4 rooms, 11 people at work');
    expect(modelLabel(1, 1)).toBe('Model of the studio: 1 room, 1 person at work');
    expect(modelLabel(0, 0)).toBe('Model of the studio: no rooms yet, nobody at work');
    expect(modelLabel(0, 1)).toBe('Model of the studio: no rooms yet, 1 person at work');
  });
});

describe('still office', () => {
  const storage = () => {
    const store = new Map<string, string>();
    return { store, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  };

  it('counts only "on" as on', () => {
    expect(parseStill('on')).toBe(true);
    expect(parseStill(null)).toBe(false);
    expect(parseStill('true')).toBe(false);
    expect(parseStill('')).toBe(false);
  });

  it('says what changed', () => {
    expect(stillWords(true)).toBe('Still office on. The office stops moving.');
    expect(stillWords(false)).toBe('Still office off. The office moves again.');
  });

  it('is kept per browser and shown to the CSS as an attribute on the page', () => {
    const s = storage();
    const root = { dataset: {} as Record<string, string | undefined> };
    keepStill(s, true);
    markStill(root, true);
    expect(s.store.get(STILL_KEY)).toBe('on');
    expect(readStill(s)).toBe(true);
    expect(root.dataset.still).toBe('on');
    keepStill(s, false);
    markStill(root, false);
    expect(s.store.has(STILL_KEY)).toBe(false);
    expect(readStill(s)).toBe(false);
    expect(root.dataset.still).toBeUndefined();
  });

  it('still works for this visit when the browser refuses storage', () => {
    const refuse = () => {
      throw new Error('blocked');
    };
    const blocked = { getItem: refuse, setItem: refuse, removeItem: refuse };
    expect(readStill(blocked)).toBe(false);
    expect(() => keepStill(blocked, true)).not.toThrow();
  });
});
