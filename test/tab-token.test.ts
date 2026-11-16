import { describe, expect, it } from 'vitest';
import { keepToken, type TokenStore } from '../web/src/lib/token.ts';

/** A tab's sessionStorage as a plain map, and what it holds afterwards. */
function tab(held: Record<string, string> = {}): { store: TokenStore; held: () => Record<string, string> } {
  const items = new Map(Object.entries(held));
  return {
    store: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    },
    held: () => Object.fromEntries(items),
  };
}

describe("an office tab's access token", () => {
  it('keeps the token from the link for the next load', () => {
    const { store, held } = tab();
    expect(keepToken(store, 'from-link')).toBe('from-link');
    expect(held()).toEqual({ 'worklings-token': 'from-link' });
  });

  it('reconnects after a reload with the token it kept', () => {
    const { store, held } = tab({ 'worklings-token': 'kept' });
    expect(keepToken(store, null)).toBe('kept');
    expect(held()).toEqual({ 'worklings-token': 'kept' });
  });

  it('reconnects a tab opened before the rename, moving its token to the new name', () => {
    const { store, held } = tab({ 'headcount-token': 'from-headcount' });
    expect(keepToken(store, null)).toBe('from-headcount');
    expect(held()).toEqual({ 'worklings-token': 'from-headcount' });
    // The next reload finds it under the new name alone.
    expect(keepToken(store, null)).toBe('from-headcount');
  });

  it('prefers the token under the new name, and drops the old one', () => {
    const { store, held } = tab({ 'worklings-token': 'new', 'headcount-token': 'old' });
    expect(keepToken(store, null)).toBe('new');
    expect(held()).toEqual({ 'worklings-token': 'new' });
  });

  it("takes a new link's token over any it kept", () => {
    const { store, held } = tab({ 'worklings-token': 'new', 'headcount-token': 'old', other: 'left alone' });
    expect(keepToken(store, 'fresh')).toBe('fresh');
    expect(held()).toEqual({ 'worklings-token': 'fresh', other: 'left alone' });
  });

  it('has no token without a link or one kept, and stores nothing', () => {
    const { store, held } = tab();
    expect(keepToken(store, null)).toBeNull();
    expect(keepToken(store, '')).toBeNull();
    expect(held()).toEqual({});
  });
});
