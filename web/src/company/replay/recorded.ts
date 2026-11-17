// What the demo's recorded run was started with (SPEC-v0.8.md, "The demo replay"), kept apart from the recording so the
// start form knows it without loading the frames. test/demo-replay.test.ts holds these to recording.json.
export const RECORDED_PROMPT =
  'Build haiku-check, a tiny zero-dependency Node CLI that reads a poem from a file, counts the syllables on each line and says whether it is a haiku (5, 7, 5). Keep a todo list as you go, and have a subagent write the tests with node:test while you write the code. Finish by running npm test. No questions needed: make the small calls yourself.';
export const RECORDED_FOLDER = 'C:\\Users\\you\\Projects\\haiku-check';

/** What the demo's start form says Start does with one Claude Code session, so nobody thinks their words run. */
export function replayNote(words: string): string {
  const typed = words.trim();
  if (typed === '' || typed === RECORDED_PROMPT) return 'Nothing runs in your browser: Start replays a real Claude Code run of these words, recorded once and sped up.';
  return `Nothing runs in your browser, so Start replays the recorded run of “${short(RECORDED_PROMPT)}”, not your words.`;
}

const short = (text: string): string => (text.length <= 60 ? text : `${text.slice(0, 57).trimEnd()}…`);
