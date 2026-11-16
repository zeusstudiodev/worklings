// Adds and removes the office's http hooks in a Claude Code settings file, leaving every other setting alone.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { plainPath } from '../safe-fs.ts';

/** The events the office listens to. SessionStart is missing on purpose: it accepts only command hooks. */
export const HOOK_EVENTS = [
  'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
  'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'SessionEnd', 'PreCompact', 'PostCompact',
  'TeammateIdle', 'TaskCreated', 'TaskCompleted',
] as const;

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);
/** The `from` parameter on the office's hook URLs: it tells our hooks apart from everyone else's. */
const MARK = 'worklings';
/** The marker hooks got while the tool was called Headcount. They still post to the office, count as ours, and are
 * replaced on install and removed on uninstall. */
const LEGACY_MARK = 'headcount';
export const DEFAULT_PORT = 7421;

export const hookUrl = (port: number) => `http://127.0.0.1:${port}/hooks?from=${MARK}`;

/** The marker on one of the office's hooks, or null for a hook that belongs to someone else. */
function markOf(hook: unknown): string | null {
  const url = typeof hook === 'object' && hook !== null ? (hook as { url?: unknown }).url : undefined;
  if (typeof url !== 'string') return null;
  // The whole parameter value, so `from=worklings-bot` or `from=headcounter` stay someone else's.
  const from = /[?&]from=([^&#]*)/.exec(url)?.[1];
  return from === MARK || from === LEGACY_MARK ? from : null;
}
/** True for one of the office's own hooks (its URL says ?from=worklings, or ?from=headcount from an earlier version). */
export const isOurs = (hook: unknown): boolean => markOf(hook) !== null;

/** Project-local settings (gitignored, only this project's sessions) unless `user` asks for every session. */
export function settingsFile(root: string, user = false, home = homedir()): string {
  return user ? join(home, '.claude', 'settings.json') : join(root, '.claude', 'settings.local.json');
}

type Settings = Record<string, unknown> & { hooks?: Record<string, unknown> };
type Group = { matcher?: string; hooks?: unknown[] } & Record<string, unknown>;

/** The most a settings file or .gitignore may hold for Worklings to read it. */
const MAX_SETTINGS_BYTES = 1024 * 1024;

/** A file's text when it is a real file of at most 1 MB, null when there is none; anything else is refused. */
function smallText(file: string): string | null {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile()) throw new Error(`${file} is not a file, so Worklings won't read it.`);
  if (stat.size > MAX_SETTINGS_BYTES) throw new Error(`${file} is bigger than 1 MB, so Worklings won't read it.`);
  return readFileSync(file, 'utf8');
}

function read(file: string): Settings {
  const text = smallText(file);
  if (text === null || !text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Settings;
  } catch {
    // fall through to the error below
  }
  throw new Error(`${file} is not a JSON object, so Worklings won't touch it. Fix it by hand and try again.`);
}

function write(file: string, settings: Settings) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Removes the office's hook entries from a settings object; returns how many were removed. */
function strip(settings: Settings): number {
  let removed = 0;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept: Group[] = [];
    for (const group of groups as Group[]) {
      if (!Array.isArray(group?.hooks)) {
        kept.push(group);
        continue;
      }
      const remaining = group.hooks.filter((h) => !isOurs(h));
      removed += group.hooks.length - remaining.length;
      if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    }
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return removed;
}

/**
 * A settings file the office may read and rewrite. In a project (`project` is its root) the path goes through
 * plainPath: a cloned repo can ship `.claude` or the settings file as a symlink or junction, and the office never writes
 * through one. The person's own settings (`--user`) are theirs to link as they like.
 */
const writable = (file: string, project?: string) => (project === undefined ? file : plainPath(project, file));

export function installHooks(file: string, port = DEFAULT_PORT, project?: string): { events: string[] } {
  const target = writable(file, project);
  const settings = read(target);
  strip(settings);
  const hooks = (settings.hooks ??= {}) as Record<string, Group[]>;
  for (const event of HOOK_EVENTS) {
    const entry: Group = { hooks: [{ type: 'http', url: hookUrl(port), timeout: 2 }] };
    if (TOOL_EVENTS.has(event)) entry.matcher = '*';
    (hooks[event] ??= []).push(entry);
  }
  write(target, settings);
  return { events: [...HOOK_EVENTS] };
}

export function uninstallHooks(file: string, project?: string): { removed: number } {
  const target = writable(file, project);
  if (!existsSync(target)) return { removed: 0 };
  const settings = read(target);
  const removed = strip(settings);
  if (removed > 0) write(target, settings);
  return { removed };
}

/** `legacy` is true when an earlier version installed some of the hooks; `installHooks` brings them up to date. */
export function hooksStatus(file: string, project?: string): { installed: boolean; port: number | null; events: string[]; legacy: boolean } {
  const target = writable(file, project);
  if (!existsSync(target)) return { installed: false, port: null, events: [], legacy: false };
  const hooks = read(target).hooks ?? {};
  // A set: a file with hooks from an earlier version and from this one still has each event once.
  const events = new Set<string>();
  let port: number | null = null;
  let legacy = false;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as Group[]) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const mark = markOf(hook);
        if (!mark) continue;
        events.add(event);
        if (mark === LEGACY_MARK) legacy = true;
        const m = /:(\d+)\/hooks/.exec((hook as { url: string }).url);
        if (m?.[1]) port = Number(m[1]);
      }
    }
  }
  return { installed: events.size > 0, port, events: [...events], legacy };
}

const IGNORED = /^\/?\.claude\/settings\.local\.json\s*$/m;

/**
 * The project's .gitignore and its text, when the folder is a git repository: never through a link, and only a real
 * file of at most 1 MB, as for a settings file (a folder, a pipe or a huge file there is refused, not read).
 */
function gitignoreOf(root: string): { file: string; text: string } | null {
  if (!existsSync(join(root, '.git'))) return null;
  const file = plainPath(root, '.gitignore');
  return { file, text: smallText(file) ?? '' };
}

/** True when ignoreLocalSettings would add its line: a git repository whose .gitignore doesn't have it yet. */
export function wouldIgnoreLocalSettings(root: string): boolean {
  const gitignore = gitignoreOf(root);
  return gitignore !== null && !IGNORED.test(gitignore.text);
}

/**
 * Makes sure git won't pick up the local settings file. Returns true when .gitignore was changed. Never through a link:
 * a cloned repo's .gitignore could point anywhere.
 */
export function ignoreLocalSettings(root: string): boolean {
  const gitignore = gitignoreOf(root);
  if (gitignore === null || IGNORED.test(gitignore.text)) return false;
  appendFileSync(gitignore.file, `${gitignore.text && !gitignore.text.endsWith('\n') ? '\n' : ''}.claude/settings.local.json\n`);
  return true;
}
