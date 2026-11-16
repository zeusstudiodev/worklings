// Cutting text that is over a limit (v0.2, SPEC-v0.2.md "Better by design"): a model can't count characters, and every
// refusal for length is a full-context retry on the CEO's model. So free text in a proposal or a plan is cut by code, at
// a sentence end where there is one, and accepted; only meaning (ids, structure, a command) is ever refused. Pure, with
// no Node APIs.

export interface Cut {
  text: string;
  /** Where it was cut: at the end of a sentence, or at a word (marked with "…"). */
  at: 'sentence' | 'word';
}

/** The part of the limit a cut must keep to be worth calling a sentence end; a shorter one is no better than a word. */
const KEEP = 0.4;

/**
 * The text cut to at most `max` characters, or null when it already fits. Ends at the last sentence end (or, in text of
 * several lines, the last line end) that keeps at least two fifths of the limit; failing that at a word, with "…".
 */
export function cutText(text: string, max: number): Cut | null {
  if (text.length <= max) return null;
  const floor = Math.max(1, Math.floor(max * KEEP));
  let end = -1;
  for (let i = max; i >= floor; i -= 1) {
    const here = text[i - 1] ?? '';
    const next = text[i] ?? '';
    if ((/[.!?]/.test(here) && (next === '' || /\s/.test(next))) || next === '\n') {
      end = i;
      break;
    }
  }
  if (end > 0) return { text: text.slice(0, end).trimEnd(), at: 'sentence' };
  const room = Math.max(1, max - 1);
  const slice = text.slice(0, room);
  const space = slice.search(/\s\S*$/);
  const head = (space >= floor ? slice.slice(0, space) : slice).replace(/[\s,;:–—-]+$/, '');
  return { text: `${head}…`, at: 'word' };
}

/** "cut from 217 to 188 characters at a sentence end", for the note that says what was cut. */
export function cutSentence(from: number, cut: Cut): string {
  return `cut from ${from.toLocaleString('en-US')} to ${cut.text.length.toLocaleString('en-US')} characters at ${cut.at === 'sentence' ? 'a sentence end' : 'a word'}`;
}
