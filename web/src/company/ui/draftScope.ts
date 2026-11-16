// What drafts (words typed and not yet sent, plan changes not saved) are kept under. The id alone is not enough: a
// company removed from the lobby and started again in the same folder gets the same id, and its drafts must not come
// back. The view has no founding time, but the company's own sentence (what it was started to build) is fixed for its
// life, so it tells a new company from the old one.

/** A short stable digest of text (FNV-1a), enough to tell two prompts apart in a key. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The key part for a company's drafts: its id and what it was started to build. */
export const draftScope = (company: { id: string; prompt: string }): string => `${company.id}~${digest(company.prompt)}`;
