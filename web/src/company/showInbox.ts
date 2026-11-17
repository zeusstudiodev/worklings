// "Show the inbox" from inside a view (v0.8): the side panel is closed until asked for, so a view that offers the inbox asks
// the shell to open it, as More's Inbox does, rather than closing itself to a home that no longer shows by default.
const SHOW_INBOX = 'worklings:show-inbox';

export const requestInbox = (): void => {
  window.dispatchEvent(new Event(SHOW_INBOX));
};

/** The shell's side: `open` runs whenever a view asks. Returns the way to stop listening. */
export function onInboxRequest(open: () => void): () => void {
  window.addEventListener(SHOW_INBOX, open);
  return () => window.removeEventListener(SHOW_INBOX, open);
}
