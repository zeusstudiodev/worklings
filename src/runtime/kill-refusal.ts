// v0.7 (SPEC-v0.7.md, "Allowed differences"): the one thing a plain desk is refused that Claude Code itself would let
// through. A session once ran `taskkill //F //IM node.exe` and stopped every Node program on the computer, the person's
// other work included. A stop by process id, of something the session started, is the session's own business and goes on
// as Claude Code decides; a stop by name, image, filter, pattern, port lookup or of every process is refused, also when it
// is written inside another shell's command string. The refusal is narrow on purpose: it must never block a stop the
// session's own work needs (parity), so a literal process id always goes through.
import { COMPUTED, type Dialect, scanCommand, type SimpleCommand } from './shell.ts';

/** What the refused session reads. */
export const KILL_REFUSAL =
  "Worklings refuses stopping programs by name, image, pattern or port across the computer: it would stop the person's other work too. Stop only what you started, by its process id (kill <pid>, taskkill /PID <pid>, Stop-Process -Id <pid>).";

/** Programs that only ever stop by name, pattern, file or port, or stop everything. */
const BY_NAME = new Set(['pkill', 'killall', 'killall5', 'fuser', 'skill', 'slay', 'tskill']);
/** Programs that stop processes, judged by what they name. */
const KILLERS = new Set(['kill', 'taskkill', 'stop-process', 'spps']);
/** Packages that stop whatever holds a port or matches a name, run through a package runner (`npx kill-port 3000`). */
const KILL_PACKAGES = new Set(['kill-port', 'fkill', 'fkill-cli', 'killport', 'kill-port-process', 'cross-port-killer']);
const RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'pnpm', 'yarn', 'bun']);
/** Words that run the rest of the line as a command of its own. */
const WRAPPERS = new Set(['sudo', 'exec', 'command', 'nohup', 'nice', 'time', 'env', 'xargs', 'call']);
/** Programs that find processes by port, name or pattern: a stop in the same command may use what they found. */
const LOOKUPS = new Set(['lsof', 'pgrep', 'pidof', 'netstat', 'ss', 'fuser', 'ps', 'get-process', 'gps', 'get-nettcpconnection', 'tasklist', 'wmic', 'get-wmiobject', 'gwmi', 'get-ciminstance', 'gcim']);
const BASHES = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
/** Shell words that come before a command (`do kill $p`, `then kill $p`). */
const SHELL_KEYWORDS = new Set(['do', 'then', 'else', 'elif', '!', '{', '(', 'time']);
/** The lookups named anywhere in the command's text, for the forms the scanner reads as one word (`$p=(Get-NetTCPConnection ...)`). */
const LOOKUP_TEXT = /\b(?:lsof|pgrep|pidof|netstat|tasklist|get-process|gps|get-nettcpconnection|get-ciminstance|get-wmiobject|gwmi)\b/i;
/** A process object's own stop method (`(Get-Process node).Kill()`, `$_.Kill()`, `.Terminate()`). */
const METHOD_STOP = /\.(?:kill|terminate)\s*\(/i;

/** A program's name as written: no folder, no .exe, lower case. */
function programOf(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').replace(/\.exe$/i, '').toLowerCase();
}

/** The command's own words, past variable assignments and wrappers such as sudo and nohup. */
function wordsOf(cmd: SimpleCommand): string[] {
  const words = [...cmd.words];
  while (words.length > 0) {
    const head = words[0] ?? '';
    if (/^[A-Za-z_]\w*=/.test(head) || SHELL_KEYWORDS.has(head)) words.shift();
    else if (WRAPPERS.has(programOf(head))) {
      words.shift();
      while (words[0]?.startsWith('-')) words.shift();
    } else break;
  }
  return words;
}

/**
 * A word that names a process by id: a number, a job, a variable or a property of one (`$PID`, `$!`, `$proc.Id`), or a
 * substitution that reads the session's own record (`$(cat app.pid)`, `$(jobs -p)`), which the scanner leaves computed.
 */
function idWord(word: string, raw: string): boolean {
  if (/^[1-9]\d{0,9}$/.test(word) || /^%\d+$/.test(word)) return true;
  if (/^\$(?:!|\{?\w+\}?)(?:\.\w+)*$/.test(word) || /^\$\(\s*\$\w+(?:\.\w+)*\s*\)$/.test(word)) return true;
  return word.includes(COMPUTED) && /\$\(\s*(?:cat\s+[^)$`;|&]+|jobs\s+-p\w*)\s*\)/.test(raw);
}

/** Whether a stop names processes only by id, never by name, image, filter or all of them. */
function byIdOnly(tool: string, args: readonly string[], dialect: Dialect, raw: string): boolean {
  const id = (word: string) => idWord(word, raw);
  if (tool === 'taskkill') {
    let named = false;
    for (let i = 0; i < args.length; i++) {
      const flag = /^(?:\/\/?|-)([A-Za-z]+)$/.exec(args[i] ?? '')?.[1]?.toLowerCase();
      if (flag === 'f' || flag === 't') continue;
      if (flag !== 'pid' || !id(args[i + 1] ?? '')) return false;
      named = true;
      i++;
    }
    return named;
  }
  if (tool === 'stop-process' || tool === 'spps' || (tool === 'kill' && dialect === 'powershell')) {
    const ids: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const word = args[i] ?? '';
      const flag = word.toLowerCase();
      if (flag === '-force' || flag === '-passthru' || flag.startsWith('-confirm') || flag === '-whatif') continue;
      if (flag === '-erroraction' || flag === '-ea') {
        i++;
        continue;
      }
      if (flag !== '-id' && word.startsWith('-')) return false;
      ids.push(...(flag === '-id' ? (args[++i] ?? '') : word).split(',').filter(Boolean));
    }
    return ids.length > 0 && ids.every(id);
  }
  // kill: one signal option first (`-9`, `-s KILL`, `-KILL`), then ids, so `kill -9 -1` and `kill -- -1` (every process the
  // user may stop) read as ids that are no process's own.
  let i = 0;
  const first = args[0] ?? '';
  if (first === '-s' || first === '-n') i = 2;
  else if (/^-[A-Za-z0-9]+$/.test(first) && !/^-[lL]$/.test(first)) i = 1;
  if (args[i] === '--') i++;
  const ids = args.slice(i);
  return ids.length > 0 && ids.every(id);
}

/** The commands of a script, its nested ones included. */
function commandsOf(command: string, dialect: Dialect, depth = 0): SimpleCommand[] {
  if (depth > 4) return [];
  const scanned = scanCommand(command, dialect);
  return scanned ? [...scanned.commands, ...scanned.nested.flatMap((body) => commandsOf(body, dialect, depth + 1))] : [];
}

/** The script another shell is given to run in its command line, with the dialect it is read in; null for none. */
function innerScript(tool: string, args: readonly string[]): { script: string; dialect: Dialect } | null {
  if (BASHES.has(tool)) {
    const at = args.findIndex((a) => /^-\w*c\w*$/.test(a));
    return at >= 0 && args[at + 1] !== undefined ? { script: args[at + 1] ?? '', dialect: 'bash' } : null;
  }
  if (POWERSHELLS.has(tool)) {
    const at = args.findIndex((a) => /^-(?:c|command)$/i.test(a));
    if (at >= 0) return { script: args.slice(at + 1).join(' '), dialect: 'powershell' };
    const encoded = args.findIndex((a) => /^-(?:e|ec|encodedcommand)$/i.test(a));
    if (encoded >= 0) {
      try {
        const bytes = Uint8Array.from(atob(args[encoded + 1] ?? ''), (c) => c.charCodeAt(0));
        return { script: new TextDecoder('utf-16le').decode(bytes), dialect: 'powershell' };
      } catch {
        return null;
      }
    }
    return null;
  }
  if (tool === 'cmd') {
    const at = args.findIndex((a) => /^\/\/?[ck]$/i.test(a));
    return at >= 0 ? { script: args.slice(at + 1).join(' '), dialect: 'bash' } : null;
  }
  return null;
}

function refusedIn(command: string, dialect: Dialect, depth: number): boolean {
  if (depth > 4) return false;
  const all = commandsOf(command, dialect);
  // A stop in a command that also finds processes by port or name may be stopping what it found.
  const looksUp = all.some((cmd) => LOOKUPS.has(programOf(wordsOf(cmd)[0] ?? ''))) || LOOKUP_TEXT.test(command);
  let previous: SimpleCommand | null = null;
  for (const cmd of all) {
    const words = wordsOf(cmd);
    const tool = programOf(words[0] ?? '');
    const args = words.slice(1);
    if (BY_NAME.has(tool)) return true;
    if (RUNNERS.has(tool) && args.some((a) => KILL_PACKAGES.has(programOf(a)))) return true;
    if (tool === 'wmic' && args.some((a) => /^process$/i.test(a)) && args.some((a) => /^(?:delete|terminate)$/i.test(a))) return true;
    const inner = innerScript(tool, args);
    if (inner && refusedIn(inner.script, inner.dialect, depth + 1)) return true;
    if (KILLERS.has(tool)) {
      if (looksUp) return true;
      // `$proc | Stop-Process`: a process object the session holds in a variable, piped in.
      const piped = args.length === 0 && dialect === 'powershell' && previous !== null && /^\$\w+(?:\.\w+)*$/.test(previous.raw.trim());
      if (!piped && !byIdOnly(tool, args, dialect, cmd.raw)) return true;
    }
    previous = cmd;
  }
  return looksUp && METHOD_STOP.test(command);
}

/**
 * Whether a Bash or PowerShell command would stop programs across the computer rather than by the ids of what the session
 * started, read from its parsed commands and the scripts it hands to other shells.
 */
export function machineWideStop(command: string, dialect: Dialect): boolean {
  if (command.length > 100_000) return false;
  return refusedIn(command, dialect, 0);
}

/** The PreToolUse hook's answer for a payload: a denial for a machine-wide stop, else nothing (Claude Code goes on as it would). */
export function preToolAnswer(payload: unknown): object {
  if (typeof payload !== 'object' || payload === null) return {};
  const p = payload as Record<string, unknown>;
  const tool = p.tool_name;
  const input = typeof p.tool_input === 'object' && p.tool_input !== null ? (p.tool_input as Record<string, unknown>) : {};
  if ((tool !== 'Bash' && tool !== 'PowerShell') || typeof input.command !== 'string') return {};
  if (!machineWideStop(input.command, tool === 'PowerShell' ? 'powershell' : 'bash')) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: KILL_REFUSAL } };
}
