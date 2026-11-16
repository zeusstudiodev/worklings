// A PreToolUse hook for the benchmark's one-prompt arm: it blocks commands that stop programs by name across the whole
// computer. A session once ran `taskkill //F //IM node.exe`, which stopped every Node program on the machine (the harness,
// Claude Code itself and the person's own hubs). Stopping a program you started, by its PID, stays allowed.
// Claude Code passes the tool call as JSON on stdin; exit code 2 blocks it and stderr tells the model why.
import { readFileSync } from 'node:fs';
import { MACHINE_KILL } from './kill-guard.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
if (MACHINE_KILL.test(command)) {
  process.stderr.write('Stopping programs by name stops them across the whole computer, other people\'s included. Stop only a process you started, by its PID.\n');
  process.exit(2);
}
process.exit(0);
