// The plain arm's PreToolUse hook: the same machine-wide kill refusal the Worklings arm's office applies
// (src/runtime/kill-refusal.ts), so both arms refuse exactly the same commands.
import { preToolAnswer } from '../../src/runtime/kill-refusal.ts';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let payload = null;
  try {
    payload = JSON.parse(input);
  } catch {
    // not a hook payload: nothing to refuse
  }
  process.stdout.write(JSON.stringify(preToolAnswer(payload)));
});
