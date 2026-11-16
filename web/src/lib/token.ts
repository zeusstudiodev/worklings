// Where a tab keeps the office's access token. Nothing here touches the DOM, so tests run it against a plain stub.

const TOKEN_KEY = 'worklings-token';
/** Where tabs opened while Worklings was called Headcount kept the token: moved to TOKEN_KEY on the next load. */
const LEGACY_TOKEN_KEY = 'headcount-token';

/** The part of sessionStorage the token needs. */
export interface TokenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The tab's token: the link's when it carries one, else the one kept earlier under either name. Keeps it under the current name. */
export function keepToken(store: TokenStore, fromLink: string | null): string | null {
  const token = fromLink || store.getItem(TOKEN_KEY) || store.getItem(LEGACY_TOKEN_KEY) || null;
  if (token) store.setItem(TOKEN_KEY, token);
  store.removeItem(LEGACY_TOKEN_KEY);
  return token;
}
