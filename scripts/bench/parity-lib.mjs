// v0.7's parity bench (SPEC-v0.7.md, "Proving not worse"): what both arms share, so they are run and judged the same way.
import { fileURLToPath } from 'node:url';

/** The Claude Code both arms run, with the profile BENCH_PROFILE names (scripts/bench/profile-claude.mjs). */
export const PROFILE_CLAUDE = fileURLToPath(new URL('./profile-claude.mjs', import.meta.url));
export const PROFILE = process.env.BENCH_PROFILE === 'user' ? 'user' : 'blank';
/** Both arms run in the same permission mode: a headless plain session can't answer prompts, and the folder is a throwaway. */
export const PERMISSION = process.env.BENCH_PERMISSION || 'bypassPermissions';
/** The one reply either arm gives when the session ends its turn with questions (the own-setup check's kickoff questions). */
export const ANSWER = 'go with your assumptions';
/**
 * Whether either arm answers end-of-turn questions at all (off for the blank parity bench unless set): `1` when the last
 * words end with a question, `always` the first end of a turn whatever it says (a kickoff brief that ends "say go and I'll
 * build it" asks without a question mark).
 */
export const ANSWERS = process.env.BENCH_ANSWER_QUESTIONS === '1' || process.env.BENCH_ANSWER_QUESTIONS === 'always';
const ALWAYS = process.env.BENCH_ANSWER_QUESTIONS === 'always';

/** A session's last words as the Worklings inbox keeps them (the end of long ones), so both arms read the same text. */
export function lastWords(text) {
  if (typeof text !== 'string') return text;
  return text.length > 4000 ? `…${text.slice(-3999)}` : text;
}

/**
 * Whether a session's last words wait for the person: a question near their end. The same rule for both arms; it is
 * applied once per run, so a reply that is itself answered with a question still ends the run.
 */
export function asksQuestions(text) {
  if (ALWAYS) return true;
  if (typeof text !== 'string') return false;
  const end = text.trim().slice(-1500);
  return /\?\s*(?:[*_`)"'\]]*\s*)?$/m.test(end) || /\?\s*\n/.test(end);
}
