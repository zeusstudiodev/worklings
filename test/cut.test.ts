// Free text over a limit is cut by code, not sent back to the model (v0.2): at a sentence end where there is one.
import { describe, expect, it } from 'vitest';
import { cutSentence, cutText } from '../src/core/cut.ts';

describe('cutText', () => {
  it('leaves text that fits alone', () => {
    expect(cutText('Short.', 10)).toBeNull();
    expect(cutText('x'.repeat(200), 200)).toBeNull();
  });

  it('cuts at the last sentence end inside the limit', () => {
    const text = 'One thing. Two things. Three things, and more besides.';
    expect(cutText(text, 30)).toEqual({ text: 'One thing. Two things.', at: 'sentence' });
    expect(cutText(text, 22)).toEqual({ text: 'One thing. Two things.', at: 'sentence' });
  });

  it('counts a question or an exclamation mark, and ends a block of lines at a line end', () => {
    expect(cutText('Why not? Because. And then some more words.', 20)).toEqual({ text: 'Why not? Because.', at: 'sentence' });
    expect(cutText('First line of the brief\nSecond line of the brief\nThird line', 40)).toEqual({ text: 'First line of the brief', at: 'sentence' });
  });

  it('does not take a dot inside a word, a number or a file name for a sentence end', () => {
    const cut = cutText('Open src/app.ts and read version 2.5 of the spec before you change anything in it at all', 40);
    expect(cut?.at).toBe('word');
  });

  it('falls back to a word with "…" when no sentence end keeps two fifths of the limit', () => {
    const text = 'A very long first sentence that does not end for quite a while yet. Then a short one.';
    const cut = cutText(text, 50);
    expect(cut?.at).toBe('word');
    expect(cut?.text).toBe('A very long first sentence that does not end for…');
    expect(cut?.text.length).toBeLessThanOrEqual(50);
  });

  it('cuts text with no spaces at the limit, and never to more than the limit', () => {
    for (const max of [5, 20, 60, 300]) {
      const cut = cutText('x'.repeat(max * 3), max);
      expect(cut?.text.length).toBeLessThanOrEqual(max);
      expect(cut?.text.endsWith('…')).toBe(true);
    }
  });

  it('says what it cut', () => {
    const cut = cutText('One thing. Two things. Three things, and more besides.', 30);
    if (!cut) throw new Error('expected a cut');
    expect(cutSentence(54, cut)).toBe('cut from 54 to 22 characters at a sentence end');
    expect(cutSentence(1200, { text: 'x'.repeat(990), at: 'word' })).toBe('cut from 1,200 to 990 characters at a word');
  });
});
