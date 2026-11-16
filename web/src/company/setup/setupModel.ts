// What the lobby says on a first run (SPEC-v3.md, "First run guides people"): whether Claude Code is installed and
// signed in, as the hub's /api/setup says it, and what watching an existing project writes, as /api/watch plans it.
// Pure, for tests; setupApi.ts asks the hub.
import { ActionError } from '../types.ts';

export type ClaudeState = 'ready' | 'missing' | 'signed-out' | 'unknown';

/** Claude Code as the hub found it (src/doctor.ts, ClaudeStatus), the fields the lobby uses. */
export interface SetupClaude {
  state: ClaudeState;
  message: string;
  fix: string | null;
  link: string | null;
}

export interface SetupView {
  claude: SetupClaude;
  checkedAt: number;
}

/** What watching a folder writes (src/hub/setup-routes.ts, WatchPlan), shown before anything is written. */
export interface WatchPlan {
  folder: string;
  file: string;
  port: number;
  events: number;
  installed: boolean;
  installedPort: number | null;
  gitignore: boolean;
  open: string;
}

/** The answer to adding the hooks: the plan as it stood, and whether the .gitignore gained its line. */
export interface WatchResult extends WatchPlan {
  gitignoreUpdated: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const STATES: readonly string[] = ['ready', 'missing', 'signed-out', 'unknown'];
const orNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The setup answer as the lobby uses it, or a refusal: an answer it can't read never passes for "ready". */
export function asSetup(body: unknown): SetupView {
  const claude = isObj(body) && isObj(body.claude) ? body.claude : null;
  if (!claude || typeof claude.state !== 'string' || !STATES.includes(claude.state) || typeof claude.message !== 'string') {
    throw new ActionError(500, "The office checked Claude Code but didn't say how it went.", 'bad-answer');
  }
  const checkedAt = isObj(body) && typeof body.checkedAt === 'number' ? body.checkedAt : 0;
  return { claude: { state: claude.state as ClaudeState, message: claude.message, fix: orNull(claude.fix), link: orNull(claude.link) }, checkedAt };
}

/** The watch plan as the hub answers it, every field in place, or a refusal. */
export function asWatchPlan(body: unknown): WatchResult {
  if (
    isObj(body) && typeof body.folder === 'string' && typeof body.file === 'string' && typeof body.port === 'number' && typeof body.events === 'number' &&
    typeof body.installed === 'boolean' && typeof body.gitignore === 'boolean' && typeof body.open === 'string'
  ) {
    return {
      folder: body.folder, file: body.file, port: body.port, events: body.events, installed: body.installed,
      installedPort: typeof body.installedPort === 'number' ? body.installedPort : null,
      gitignore: body.gitignore, open: body.open, gitignoreUpdated: body.gitignoreUpdated === true,
    };
  }
  throw new ActionError(500, "The office read the folder but didn't say what watching it would change.", 'bad-answer');
}

/** What the lobby shows when Claude Code isn't ready. `blocks` is why starting waits, null when it doesn't. */
export interface ClaudeNotice {
  title: string;
  /** The status's own sentence. */
  text: string;
  /** What the callout writes under its title: null when the title says the fact already (signed out), so it is said once. */
  shown: string | null;
  /** The one thing to do about it. */
  fix: string | null;
  link: { href: string; label: string } | null;
  blocks: string | null;
}

const TITLES: Record<Exclude<ClaudeState, 'ready'>, string> = {
  missing: "Claude Code isn't ready",
  'signed-out': "Claude Code isn't signed in",
  unknown: "Couldn't check Claude Code's sign-in",
};

/** Null while Claude Code is ready. Missing and signed out stop Start; unknown only warns, since it may well work. */
export function claudeNotice(claude: SetupClaude): ClaudeNotice | null {
  if (claude.state === 'ready') return null;
  const blocking = claude.state !== 'unknown';
  return {
    title: TITLES[claude.state],
    text: claude.message,
    shown: claude.state === 'signed-out' ? null : claude.message,
    fix: claude.fix,
    link: claude.link ? { href: claude.link, label: claude.state === 'missing' ? 'Open the install page' : 'Open the sign-in help' } : null,
    blocks: blocking ? `${claude.message} Starting waits until that's fixed.` : null,
  };
}

/** The consent step's lines, in the order a person reads them: what is written, where, and what stays as it is. */
export function watchLines(plan: WatchPlan): string[] {
  if (plan.installed) return [`${plan.file} already reports to port ${plan.port}, so there is nothing to add.`];
  const lines = [`Adds ${plan.events} Claude Code hooks to ${plan.file}, which post to port ${plan.port} on this computer.`];
  if (plan.installedPort !== null) lines.push(`Its hooks post to port ${plan.installedPort} now; this points them at ${plan.port}.`);
  if (plan.gitignore) lines.push(`Adds ${plan.file} to the folder's .gitignore, so it isn't committed.`);
  lines.push('Nothing else in the project changes.');
  return lines;
}

/** What a screen reader hears when the notice appears or a check ends with it still there: the title, then the one fix. */
export function noticeSpeech(notice: ClaudeNotice): string {
  const parts = [notice.title, notice.shown, notice.fix].filter((x): x is string => !!x);
  return parts.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(' ');
}

/**
 * A folder as one word for a shell, as the hub's own copyable commands quote it (src/hub/setup-routes.ts, shellQuote):
 * single quotes, so `$`, backticks and spaces stay literal. For PowerShell, where a Windows path (a drive or a share) is
 * pasted, every character it takes as a single quote (' ‘ ’ ‚ ‛) is doubled; for bash a ' is closed, escaped and reopened.
 */
export function quoteFolder(folder: string): string {
  const windows = /^(?:[A-Za-z]:|\\\\)/.test(folder);
  return `'${windows ? folder.replace(/['‘’‚‛]/g, (q) => q + q) : folder.replaceAll("'", String.raw`'\''`)}'`;
}

/** How to take the hooks out again: the CLI has the command, the hub has no route for it. */
export const removeCommand = (folder: string): string => `npx worklings hooks uninstall ${quoteFolder(folder)}`;
