// Claude Code's own commands that aren't a turn, answered as Claude Code 2.1.312 answers them, for the stand-ins that
// play it (fake-claude.mjs and fake-desk.mjs): `--version` and `auth status`, which `worklings doctor` and the hub's
// first-run check run. Await answerClaudeCommand(argv) before anything else: for those arguments it answers and exits
// (or never answers, for hang), and for every other it returns at once.
//
//   FAKE_CLAUDE_VERSION  the version --version prints, as "<version> (Claude Code)" (2.1.312 unless set)
//   FAKE_CLAUDE_AUTH     how `auth status` answers:
//     signed-in    a claude.ai sign-in on a Max plan, exit code 0 (the default)
//     signed-out   not signed in, exit code 1
//     api-key      an API key from ANTHROPIC_API_KEY, exit code 0
//     no-auth      an older Claude Code without the command: commander's "unknown command", exit code 1
//     bad-json     plain text, exit code 0
//     hang         never answers (gives up after five minutes)
// The answers are fixtures/claude-2.1.312/auth/, captured from the real one with the email and organisation replaced.
import { readFileSync, writeSync } from 'node:fs';

const VERSION = '2.1.312';
const GIVE_UP_MS = 5 * 60_000;
const AUTH = {
  'signed-in': { file: 'status-signed-in.json', code: 0 },
  'signed-out': { file: 'status-signed-out.json', code: 1 },
  'api-key': { file: 'status-api-key.json', code: 0 },
};

/** Writes synchronously, so nothing is lost when the process exits straight after. */
function finish(stdout, stderr, code) {
  if (stdout) writeSync(1, stdout);
  if (stderr) writeSync(2, stderr);
  process.exit(code);
}

export async function answerClaudeCommand(argv) {
  if (argv[0] === '--version' || argv[0] === '-v') finish(`${process.env.FAKE_CLAUDE_VERSION || VERSION} (Claude Code)\n`, '', 0);
  if (argv[0] !== 'auth') return;
  if (argv[1] !== 'status') finish('', `fake-claude: only auth status is played, not auth ${argv[1] ?? ''}\n`, 3);
  const mode = process.env.FAKE_CLAUDE_AUTH || 'signed-in';
  if (mode === 'no-auth') finish('', "error: unknown command 'auth'\n", 1);
  if (mode === 'bad-json') finish('Signed in, probably.\n', '', 0);
  if (mode === 'hang') {
    setTimeout(() => process.exit(4), GIVE_UP_MS);
    await new Promise(() => {});
  }
  const answer = Object.hasOwn(AUTH, mode) ? AUTH[mode] : null;
  if (!answer) finish('', `fake-claude: unknown FAKE_CLAUDE_AUTH "${mode}"; use one of ${[...Object.keys(AUTH), 'no-auth', 'bad-json', 'hang'].join(', ')}.\n`, 3);
  finish(readFileSync(new URL(`./fixtures/claude-2.1.312/auth/${answer.file}`, import.meta.url), 'utf8'), '', answer.code);
}
