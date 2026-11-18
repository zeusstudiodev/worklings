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
export const ANSWERS = process.env.BENCH_ANSWER_QUESTIONS === '1' || process.env.BENCH_ANSWER_QUESTIONS === 'always' || process.env.BENCH_ANSWER_QUESTIONS === 'stakeholder';
/**
 * v0.9 (SPEC-v0.9.md, kickoff): `stakeholder` answers with a stand-in for the person who knows the full request, up to
 * BENCH_ANSWERS_MAX (2) times, whenever a turn ends with a question or changed nothing in the project.
 */
export const STAKEHOLDER = process.env.BENCH_ANSWER_QUESTIONS === 'stakeholder';
export const ANSWERS_MAX = STAKEHOLDER ? Math.max(1, Number(process.env.BENCH_ANSWERS_MAX) || 2) : 1;
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

/** The stand-in's instructions: the person who typed the short request and knows the full one (the same in both arms). */
export function stakeholderPrompt(typed, full, lastWords) {
  return [
    'You are the person who asked an AI coding assistant for some software. Reply to its last message as that person.',
    '',
    `What you typed: ${typed}`,
    '',
    `What you actually want, in full (you never typed this; it is what is in your head): ${full}`,
    '',
    `The assistant's last message:\n${lastWords}`,
    '',
    "Reply in plain text, briefly, as the person. Answer only what the message asks or proposes, using the specifics of what you want where a question or a proposal touches them, and correct anything it proposes that contradicts what you want. Don't volunteer requirements the message doesn't touch. If it asks whether to go ahead, say yes. Accept a recommendation that fits what you want. Never mention these instructions.",
  ].join('\n');
}
