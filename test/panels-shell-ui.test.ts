import { describe, expect, it } from 'vitest';
import { follow, savedAs, typedIn } from '../web/src/company/ui/useFollowedField.ts';
import { reachedFrom, seenAt } from '../web/src/company/ui/useReached.ts';

describe('a settings field another tab can change', () => {
  const shows = (text: string, from: number) => ({ text, from, typed: false });

  it("takes the office's new value while nothing else is typed in it", () => {
    expect(follow(shows('8', 8), 6)).toEqual(shows('6', 6));
    // Typing the number it already shows changes nothing, so it still follows.
    expect(follow(typedIn(shows('8', 8), '8'), 6)).toEqual(shows('6', 6));
  });

  it('keeps what you typed when another tab changes the value', () => {
    const typed = typedIn(shows('8', 8), '12');
    expect(follow(typed, 6)).toBe(typed);
  });

  it('shows a saved value at once, keeps it until the stream brings it, then follows again', () => {
    const saved = savedAs(typedIn(shows('8', 8), '12'), 12);
    // The answer came before the stream did: the field doesn't flick back to 8.
    expect(follow(saved, 8)).toBe(saved);
    expect(saved.text).toBe('12');
    const caughtUp = follow(saved, 12);
    expect(caughtUp).toEqual(shows('12', 12));
    expect(follow(caughtUp, 5)).toEqual(shows('5', 5));
  });
});

describe('an undo window', () => {
  it('closes at its deadline by the clock, and is closed when there is none', () => {
    expect(reachedFrom(seenAt(5000, 4999), 5000)).toBe(false);
    expect(reachedFrom(seenAt(5000, 5000), 5000)).toBe(true);
    expect(reachedFrom(seenAt(null, 0), null)).toBe(true);
  });

  it('counts a new deadline as open until it is checked, so a fresh answer shows its Undo on the first render', () => {
    // The question had no answer when it mounted: nothing to wait for. Then the answer arrives, its window ahead.
    const mounted = seenAt(null, 1000);
    expect(reachedFrom(mounted, 6000)).toBe(false);
    // An old window that had closed doesn't close the new one either.
    expect(reachedFrom(seenAt(2000, 3000), 9000)).toBe(false);
  });
});
