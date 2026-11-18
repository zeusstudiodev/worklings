// The folders a company may run in, and the folder browser of the start form. A company gets the project's folder and
// runs Claude Code in it, so the hub refuses anything that isn't a folder of the person's own: the whole drive, the
// home folder, system folders, its own and Claude Code's folders, and anything inside or around another company.
// Browsing only reads: git runs for the folder the person chose and for no other, and never runs a program of the
// folder's own. What the folder brings for Claude Code is read as untrusted text, with size caps, and never run.
import { execFile } from 'node:child_process';
import { accessSync, constants, type Dirent, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path';
import type { Library } from '../composer/library.ts';
import { detect } from '../composer/detect.ts';
import { parseFrontmatter } from '../core/frontmatter.ts';
import { inSentence, parseStudio } from '../core/studio.ts';
import { isOurs } from '../server/hooks-config.ts';
import type { FolderPacks } from '../core/packs.ts';
import { folderPacks } from '../packs/install.ts';
import { isInside } from '../server/office.ts';

/** The longest folder path the hub takes: Windows' classic limit, which many tools still trip over. */
export const MAX_FOLDER = 260;
/** Subfolders listed at most, a level at a time. */
const MAX_LISTED = 1_000;

/** A company already in the lobby, for the inside-or-around checks. */
export interface CompanyPlace {
  name: string;
  root: string;
}

export interface Places {
  companies: readonly CompanyPlace[];
  /** The person's home folder. */
  home: string;
  /** The hub's own folder (~/.worklings) and Claude Code's (~/.claude). */
  own: readonly string[];
  platform?: NodeJS.Platform;
}

export type FolderRefusal = { ok: false; status: number; code: string; message: string };
export type FolderCheck = { ok: true; root: string; exists: boolean } | FolderRefusal;

const refuse = (message: string, code = 'bad-folder', status = 400): FolderRefusal => ({ ok: false, status, code, message });
const hasControl = (text: string) => [...text].some((c) => (c.codePointAt(0) ?? 0) < 0x20);

function systemFolders(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    const drive = env.SystemDrive ?? 'C:';
    return [env.SystemRoot ?? `${drive}\\Windows`, env.ProgramFiles ?? `${drive}\\Program Files`, env['ProgramFiles(x86)'] ?? `${drive}\\Program Files (x86)`, env.ProgramData ?? `${drive}\\ProgramData`];
  }
  return ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/System', '/Library', '/private/etc', '/private/var/db'];
}

/** A path the person typed, made absolute and plain, or the sentence that says what's wrong with it. */
function plainFolder(raw: unknown, platform: NodeJS.Platform): { ok: true; path: string } | FolderRefusal {
  if (typeof raw !== 'string' || raw.trim() === '') return refuse('Say which folder.');
  const typed = raw.trim();
  if (typed.length > MAX_FOLDER) return refuse(`That path is longer than ${MAX_FOLDER} characters. Pick a folder with a shorter path.`);
  if (hasControl(typed)) return refuse("That isn't a folder path.");
  // Network shares and device paths: reaching one can send the person's sign-in to whoever runs it.
  if (/^[\\/]{2}/.test(typed)) return refuse('Pick a folder on this computer: network and device paths are not supported.');
  if (!isAbsolute(typed) || (platform === 'win32' && !/^[a-zA-Z]:[\\/]/.test(typed))) {
    return refuse(`Give the folder's full path, like ${platform === 'win32' ? 'C:\\Users\\you\\plant-pal' : '/home/you/plant-pal'}.`);
  }
  return { ok: true, path: resolve(typed) };
}

/**
 * Checks a folder for a new company: absolute and at most 260 characters, an existing folder or a new one whose
 * parent exists, not a system folder, the drive, the home folder or a folder around it, and not inside or around
 * another company's folder. An existing folder is taken at its real path, so a link can't put two companies in one.
 */
export function checkCompanyFolder(raw: unknown, places: Places): FolderCheck {
  const platform = places.platform ?? process.platform;
  const typed = plainFolder(raw, platform);
  if (!typed.ok) return typed;
  let root = typed.path;
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) return refuse("That folder is a link. Pick the folder it points to: Worklings doesn't work through links.");
  if (stat && !stat.isDirectory()) return refuse("That's a file, not a folder.");
  if (stat) root = realpathSync.native(root);
  else {
    const parent = dirname(root);
    if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory()) return refuse("That folder doesn't exist, and neither does the folder it would go in. Make it with New folder here.", 'missing');
    root = join(realpathSync.native(parent), basename(root));
  }
  if (dirname(root) === root) return refuse("That's a whole drive. Pick a folder in it.");
  if (isInside(root, places.home)) {
    return refuse(isInside(places.home, root) ? "That's your home folder. Pick a folder in it." : 'That folder holds your home folder. Pick one inside your home folder.');
  }
  if (systemFolders(platform).some((s) => isInside(s, root))) return refuse("That's a system folder. Pick one of your own.");
  if (places.own.some((o) => isInside(o, root) || isInside(root, o))) return refuse('That folder is where Worklings or Claude Code keep their own files. Pick another.');
  for (const c of places.companies) {
    if (isInside(c.root, root) && isInside(root, c.root)) return refuse(`${c.name} already runs here. Open it from the lobby.`, 'exists', 409);
    if (isInside(c.root, root)) return refuse(`That's inside ${c.name}'s folder. Pick another.`, 'inside', 409);
    if (isInside(root, c.root)) return refuse(`${c.name}'s folder is inside that one. Pick another.`, 'around', 409);
  }
  return { ok: true, root, exists: stat !== undefined };
}

/** True when the folder holds a company's state (its event log in .worklings/), which adding the folder reopens. */
export const hasCompanyState = (root: string): boolean => existsSync(join(root, '.worklings', 'events.jsonl'));

/**
 * A folder's path cut short for a sentence, as the lobby cuts one (cutMiddle in web/src/company/model.ts): its start and
 * its own name, "C:\Users\…\plant-pal". The web shows a refusal's sentence as it comes, so the hub cuts it.
 */
export function shortFolder(path: string, max = 40): string {
  if (path.length <= max) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]/).filter((part, i) => part !== '' || i === 0);
  if (parts.length <= 3) return `…${path.slice(-(max - 1))}`;
  const head = parts.slice(0, 2).join(sep) || sep;
  const tail = parts.at(-1) ?? '';
  const cut = `${head}${sep}…${sep}${tail}`;
  return cut.length <= max + 8 ? cut : `${head}${sep}…${tail.slice(-(max - head.length - 2))}`;
}

/** Hidden and system folders the browser leaves out, whatever folder they are in. */
const LEFT_OUT = new Set(['$recycle.bin', 'system volume information', 'config.msi', 'recovery', 'msocache', '$winreagent', 'perflogs', 'documents and settings', 'node_modules']);

/** What `detect` found in a folder, as one sentence: "A web app with React, Vite and TypeScript." */
export function describeFolder(root: string, library: Library): string {
  return readFolderKind(root, library).sentence;
}

/** What `detect` found, as describeFolder's sentence and the kind of project the pack recommendations read (v0.9). */
export function readFolderKind(root: string, library: Library): { sentence: string; domain: string | null; empty: boolean } {
  let found: ReturnType<typeof detect>;
  try {
    found = detect(root, library);
  } catch {
    return { sentence: "Worklings couldn't read this folder.", domain: null, empty: false };
  }
  const domain = found.domains[0]?.id ?? null;
  return { sentence: sentenceOf(found, library), domain: found.isEmpty ? null : domain, empty: found.isEmpty };
}

function sentenceOf(found: ReturnType<typeof detect>, library: Library): string {
  if (found.isEmpty) return found.rootFiles.length === 0 && found.folders.length === 0 ? 'An empty folder.' : 'No code here yet.';
  const names = [...new Set(found.frameworks.map((f) => f.replace(/\s+[\^~<>=v]*\d\S*$/, '')))].slice(0, 3);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : (names[0] ?? '');
  const domain = found.domains[0] ? library.domains.get(found.domains[0].id)?.title : undefined;
  const kind = domain ? inSentence(domain) : 'project';
  const article = /^[aeio]/i.test(kind) ? 'An' : 'A';
  if (list) return `${article} ${kind} with ${list}.`;
  return domain ? `${article} ${kind}.` : "A folder with files, but no stack Worklings recognises.";
}

/** True when the folder or one of its parents is a git repository (a worktree's .git is a file). */
function inRepo(root: string): boolean {
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/** Windows variable names ignore case, and a copied environment keeps whatever case it had ("Path"). */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32' || Object.hasOwn(env, name)) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function runnable(file: string): boolean {
  try {
    if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) return false;
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    // Not one this user may run, or a PATH folder they can't read: the next folder may have it.
    return false;
  }
}

/**
 * Git from the PATH's absolute folders, as a full path, or null when there is none. Started by name, git would be
 * looked for in the folder it runs in too (Windows looks there first, and a relative PATH entry such as "." or
 * "node_modules/.bin" means that folder), so a downloaded folder could put a git.exe of its own in front.
 */
export function findGit(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = runnable): string | null {
  const p = platform === 'win32' ? win32 : posix;
  const name = platform === 'win32' ? 'git.exe' : 'git';
  const dirs = (envValue(env, 'PATH', platform) ?? '').split(p.delimiter).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => d !== '' && p.isAbsolute(d));
  return dirs.map((dir) => p.join(dir, name)).find((file) => exists(file)) ?? null;
}

/** The hub's own variables that would point git at another repository than the folder's (as src/company/git.ts drops). */
const REPOSITORY_VARIABLES: ReadonlySet<string> = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR',
  'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
]);
/** How long each git command may take before the note is left out. */
const GIT_MS = 5_000;
/** A repository's own filter drivers past this many go unchecked, and so does the folder: a real one has one or two. */
const MAX_FILTERS = 20;

/**
 * Git's environment for a look at a folder: none of the hub's repository variables, no prompt, no optional lock (so
 * the index isn't written and no hook runs for it), and no lazy fetch from a partial clone's remote (Git 2.44 on),
 * whose transport the folder's config names.
 */
function gitEnv(env: NodeJS.ProcessEnv, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!REPOSITORY_VARIABLES.has(process.platform === 'win32' ? key.toUpperCase() : key)) out[key] = value;
  }
  return { ...out, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', ...extra };
}

interface GitRun {
  code: number | null;
  stdout: string;
  /** It printed more than the buffer holds. */
  overflowed: boolean;
}

/** Runs git once with an argument list and no shell, stopped after `ms`. Never rejects: null when it couldn't run. */
function runGit(git: string, root: string, args: readonly string[], env: NodeJS.ProcessEnv, ms: number): Promise<GitRun | null> {
  return new Promise((done) => {
    execFile(git, [...args], { cwd: root, env, timeout: ms, windowsHide: true, maxBuffer: 1024 * 1024, shell: false, encoding: 'utf8' }, (error, stdout) => {
      if (!error) return done({ code: 0, stdout, overflowed: false });
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return done({ code: null, stdout, overflowed: true });
      done(typeof error.code === 'number' && !error.killed ? { code: error.code, stdout, overflowed: false } : null);
    });
  });
}

/**
 * The filter drivers the folder's own git config defines (`git config` only reads, and runs nothing), so that git
 * status can run with their commands emptied: a clean filter is a program of the folder's that status would run on
 * every file it has to compare. Null when git couldn't say, or names more than MAX_FILTERS.
 */
async function ownFilters(git: string, root: string, env: NodeJS.ProcessEnv, ms: number): Promise<string[] | null> {
  const ran = await runGit(git, root, ['--no-pager', 'config', '--show-scope', '--null', '--name-only', '--get-regexp', '^filter\\.'], env, ms);
  // get-regexp ends with 1 when nothing matches.
  if (ran === null || ran.overflowed || (ran.code !== 0 && !(ran.code === 1 && ran.stdout === ''))) return null;
  const names = new Set<string>();
  const parts = ran.stdout.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] !== 'local' && parts[i] !== 'worktree') continue;
    const driver = /^filter\.(.+)\.(?:clean|smudge|process|required)$/s.exec(parts[i + 1] ?? '')?.[1];
    if (driver !== undefined) names.add(driver);
  }
  return names.size > MAX_FILTERS ? null : [...names];
}

/**
 * True when `git status` lists anything in the folder, false when it lists nothing or couldn't run. Git is the PATH's
 * (findGit), and runs none of the folder's own programs: no fsmonitor, no hooks, no pager, the folder's filter
 * drivers emptied (through GIT_CONFIG_COUNT, which takes their names as they are), no rename detection (which could
 * fetch a partial clone's missing objects), and no submodules, whose configs would be theirs.
 */
async function uncommitted(root: string, env: NodeJS.ProcessEnv, ms: number): Promise<boolean> {
  const git = findGit(env);
  if (git === null) return false;
  const filters = await ownFilters(git, root, gitEnv(env), ms);
  if (filters === null) return false;
  const emptied: Record<string, string> = {};
  let n = 0;
  for (const driver of filters) {
    for (const [key, value] of [['clean', ''], ['smudge', ''], ['process', ''], ['required', 'false']] as const) {
      emptied[`GIT_CONFIG_KEY_${n}`] = `filter.${driver}.${key}`;
      emptied[`GIT_CONFIG_VALUE_${n}`] = value;
      n += 1;
    }
  }
  if (n > 0) emptied.GIT_CONFIG_COUNT = String(n);
  const args = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-c', 'status.renames=false', '--no-pager', 'status', '--porcelain', '--ignore-submodules=all'];
  const ran = await runGit(git, root, args, gitEnv(env, emptied), ms);
  return ran !== null && (ran.code === 0 || ran.overflowed) && ran.stdout.trim() !== '';
}

// ---------------------------------------------------------------------------------------------------------------------
// What the folder brings for Claude Code. Desks run `claude -p`, which never shows the workspace trust dialog, and
// there Claude Code uses the project's hooks, `env`, helper commands such as apiKeyHelper, the plugins its settings
// turn on, .mcp.json servers (approved or not, in the standard way; lean desks leave them out) and agents from the start (the docs' "What runs before you trust a
// folder"). The status line and the @ file suggestions belong to the interactive prompt, which a desk doesn't have, so
// they get no note.

/** Claude Code's settings in a project, shared and local. */
const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'] as const;
/** Commands Claude Code runs by itself, outside its permission checks; apiKeyHelper has a note of its own. */
const HELPERS = ['awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper'] as const;
const SETTINGS_BYTES = 1024 * 1024;
const AGENT_BYTES = 256 * 1024;
/** Agent files read at most, and how deep in .claude/agents: the rest count as the folder's own. */
const MAX_AGENT_FILES = 200;
const AGENT_DEPTH = 4;

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A file's text when it is a file of at most `max` bytes; 'too big' when it is bigger; null when there is none, or it
 * is something Claude Code couldn't read either (a folder, a device, a file this user can't open).
 */
function readCapped(path: string, max: number): string | 'too big' | null {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile()) return null;
    if (stat.size > max) return 'too big';
    return readFileSync(path, 'utf8');
  } catch {
    // Unreadable for this user, so for their Claude Code too.
    return null;
  }
}

/** JSON from a file, or 'unchecked' when it is too big or isn't JSON Worklings can read. */
function readJson(path: string, max: number): Fields | 'unchecked' | null {
  const text = readCapped(path, max);
  if (text === null) return null;
  if (text === 'too big') return 'unchecked';
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return isFields(value) ? value : 'unchecked';
  } catch {
    return 'unchecked';
  }
}

/** Hooks in a settings file besides the office's own (hooks-config.ts marks those). */
function foreignHooks(settings: Fields): boolean {
  if (!isFields(settings.hooks)) return false;
  for (const groups of Object.values(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (isFields(group) && Array.isArray(group.hooks) && group.hooks.some((hook) => !isOurs(hook))) return true;
    }
  }
  return false;
}

/**
 * Allow rules, which let a session use tools without asking. Not `defaultMode`: Claude Code ignores bypassPermissions
 * and auto from a project's settings files (since 2.1.257), and a desk's --permission-mode outranks the rest.
 */
function allowsWithoutAsking(settings: Fields): boolean {
  const permissions = settings.permissions;
  return isFields(permissions) && Array.isArray(permissions.allow) && permissions.allow.some((rule) => typeof rule === 'string' && rule.trim() !== '');
}

/** Whether a settings key names a command, the shell command line Claude Code would run. */
function namesCommand(settings: Fields, key: string): boolean {
  const value = settings[key];
  return typeof value === 'string' && value.trim() !== '';
}

/** Environment variables for every session and the commands it runs (Claude Code takes string values only). */
const setsEnv = (settings: Fields) => isFields(settings.env) && Object.values(settings.env).some((value) => typeof value === 'string');

/** Plugins a settings file turns on, which load wherever this computer has them installed. */
const turnsOnPlugins = (settings: Fields) => isFields(settings.enabledPlugins) && Object.values(settings.enabledPlugins).some((on) => on === true);

/** The agent files' names in .claude/agents as Claude Code reads them (`name`, else the file's), and how many went unread. */
function agentNames(dir: string): { names: string[]; unread: number } {
  const names: string[] = [];
  let seen = 0;
  let unread = 0;
  const walk = (at: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return; // not there, or not readable: nothing Claude Code reads either
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (depth < AGENT_DEPTH) walk(path, depth + 1);
        else unread += 1;
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      seen += 1;
      const text = seen > MAX_AGENT_FILES ? 'too big' : readCapped(path, AGENT_BYTES);
      if (text === 'too big') unread += 1;
      else if (text !== null) {
        const name = parseFrontmatter(text).data.name;
        names.push(typeof name === 'string' && name.trim() ? name.trim() : entry.name.slice(0, -3));
      }
    }
  };
  walk(dir, 1);
  return { names, unread };
}

/** The agents studio.yaml lists, which Worklings wrote; none when it is missing, too big or has a mistake. */
function studioAgents(root: string): Set<string> {
  const text = readCapped(join(root, '.claude', 'studio.yaml'), SETTINGS_BYTES);
  if (text === null || text === 'too big') return new Set();
  const parsed = parseStudio(text);
  return new Set(parsed.ok ? parsed.studio.roles.map((r) => r.agent ?? r.id) : []);
}

const inFiles = (files: readonly string[]) => (files.length === 1 ? (files[0] ?? '') : `${files.slice(0, -1).join(', ')} and ${files.at(-1) ?? ''}`);

/** One sentence for each part of Claude Code's setup the folder brings of its own. */
export function setupNotes(root: string): string[] {
  const notes: string[] = [];
  const hooks: string[] = [];
  const rules: string[] = [];
  const keyHelpers: string[] = [];
  const helpers: string[] = [];
  const helperKeys = new Set<string>();
  const env: string[] = [];
  const plugins: string[] = [];
  const unchecked: string[] = [];
  for (const file of SETTINGS_FILES) {
    const settings = readJson(join(root, ...file.split('/')), SETTINGS_BYTES);
    if (settings === 'unchecked') unchecked.push(file);
    else if (settings !== null) {
      if (foreignHooks(settings)) hooks.push(file);
      if (allowsWithoutAsking(settings)) rules.push(file);
      if (namesCommand(settings, 'apiKeyHelper')) keyHelpers.push(file);
      const named = HELPERS.filter((key) => namesCommand(settings, key));
      if (named.length > 0) helpers.push(file);
      for (const key of named) helperKeys.add(key);
      if (setsEnv(settings)) env.push(file);
      if (turnsOnPlugins(settings)) plugins.push(file);
    }
  }
  if (hooks.length > 0) notes.push(`It brings its own Claude Code hooks (in ${inFiles(hooks)}), which can run in every person's session.`);
  if (rules.length > 0) notes.push(`It brings its own Claude Code permission rules (in ${inFiles(rules)}), which let every person's session use some tools without asking.`);
  if (keyHelpers.length > 0) {
    notes.push(`It sets its own apiKeyHelper (in ${inFiles(keyHelpers)}): every person's session runs that command and signs in with the key it prints, instead of this computer's Claude Code login.`);
  }
  if (helpers.length > 0) {
    const keys = HELPERS.filter((key) => helperKeys.has(key));
    notes.push(`It brings its own Claude Code helper commands (${inFiles(keys)}, in ${inFiles(helpers)}), which can run in every person's session without asking.`);
  }
  if (env.length > 0) notes.push(`It sets environment variables for Claude Code (in ${inFiles(env)}), which reach every person's session and the commands it runs.`);
  if (plugins.length > 0) {
    notes.push(`It turns on Claude Code plugins (in ${inFiles(plugins)}), whose hooks, MCP servers and agents run in every person's session if this computer has them installed.`);
  }
  if (unchecked.length > 0) notes.push(`It brings Claude Code settings Worklings couldn't check (in ${inFiles(unchecked)}), which can run hooks and other commands in every person's session.`);
  const mcp = readJson(join(root, '.mcp.json'), SETTINGS_BYTES);
  if (mcp === 'unchecked') notes.push("It brings an .mcp.json Worklings couldn't check. Desks leave them out (each person loads only the MCP servers they were assigned), unless this Claude Code can't start a desk that way: then every person's session would load them.");
  else if (mcp !== null && isFields(mcp.mcpServers) && Object.keys(mcp.mcpServers).length > 0) {
    // A lean desk's --strict-mcp-config leaves them out; the standard way (the fallback) loads them in `claude -p`, approved or
    // not, so enableAllProjectMcpServers and enabledMcpjsonServers change nothing there.
    notes.push("It brings its own MCP servers (in .mcp.json). Desks leave them out (each person loads only the MCP servers they were assigned), unless this Claude Code can't start a desk that way: then every person's session would load them.");
  }
  const agents = agentNames(join(root, '.claude', 'agents'));
  const ours = agents.names.length > 0 ? studioAgents(root) : new Set<string>();
  const theirs = agents.names.filter((name) => !ours.has(name)).length + agents.unread;
  if (theirs > 0) {
    const what = theirs === 1 ? 'a Claude Code agent' : `${theirs} Claude Code agents`;
    notes.push(`It brings ${what} Worklings didn't write (in .claude/agents), which every person's session can hand work to.`);
  }
  return notes;
}

export interface FolderListing {
  /** The folder, as the hub reads it. */
  path: string;
  /** The folder above it, or null at the top of a drive. */
  parent: string | null;
  /** Its subfolders' names, a level at a time: no files, links, hidden or system folders. */
  folders: string[];
  /** What detection found there, in a sentence. */
  detected: string;
  /** What starting a company there would mean, before the press. */
  notes: string[];
  /** v0.9: the packs there, whether .claude/ takes more, and the kind of project the recommendations read. */
  packs: FolderPacks;
}

export interface ListingOptions {
  library: Library;
  env?: NodeJS.ProcessEnv;
  /**
   * The folder the person chose for the company (typed, or picked with Use this folder), not a level the browser
   * passes through. Only then does git run, for the uncommitted-changes note.
   */
  chosen?: boolean;
  /** How long each git command may take: GIT_MS when not given (tests on a busy machine give more). */
  gitTimeoutMs?: number;
}

/** One level of the folder browser: the subfolders, what's there and the notes before starting. */
export async function listFolder(raw: unknown, places: Places & ListingOptions): Promise<FolderListing | FolderRefusal> {
  const typed = plainFolder(raw, places.platform ?? process.platform);
  if (!typed.ok) return typed;
  const path = typed.path;
  if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) return refuse("That folder doesn't exist.", 'missing', 404);
  let entries: Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return refuse("Worklings can't open that folder.", 'unreadable', 403);
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && !LEFT_OUT.has(e.name.toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, MAX_LISTED);
  const notes: string[] = [];
  const company = places.companies.find((c) => isInside(c.root, path) || isInside(path, c.root));
  if (company) {
    if (isInside(company.root, path) && isInside(path, company.root)) notes.push(`${company.name} already runs here.`);
    else if (isInside(company.root, path)) notes.push(`That's inside ${company.name}'s folder.`);
    else notes.push(`${company.name}'s folder is inside this one.`);
  } else if (hasCompanyState(path)) {
    notes.push('A company worked here before: starting reopens it.');
  }
  if (!inRepo(path)) {
    notes.push(entries.length === 0 ? 'Not a git repository: starting runs git init so the work has its own branch.' : "Not a git repository, so finished tasks won't be committed until it is one.");
  } else if (places.chosen === true && (await uncommitted(path, places.env ?? process.env, places.gitTimeoutMs ?? GIT_MS))) {
    notes.push('It has uncommitted changes; the company leaves them be.');
  }
  notes.push(...setupNotes(path));
  const kind = readFolderKind(path, places.library);
  return { path, parent: dirname(path) === path ? null : dirname(path), folders, detected: kind.sentence, notes, packs: folderPacks(path, kind) };
}

const BAD_NAME = /[<>:"/\\|?*]/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** "New folder here": makes one folder, never a path of them, and never over anything that exists. */
export function makeFolder(parentRaw: unknown, nameRaw: unknown, places: Places): { ok: true; path: string } | FolderRefusal {
  const platform = places.platform ?? process.platform;
  const parent = plainFolder(parentRaw, platform);
  if (!parent.ok) return parent;
  if (!lstatSync(parent.path, { throwIfNoEntry: false })?.isDirectory()) return refuse("The folder to put it in doesn't exist.", 'missing', 404);
  const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
  if (name === '') return refuse('Name the new folder.');
  if (name.length > 100) return refuse('Keep the name to 100 characters.');
  if (BAD_NAME.test(name) || hasControl(name) || name === '.' || name === '..' || /[. ]$/.test(name) || RESERVED_NAME.test(name)) {
    return refuse('A folder name can\'t hold < > : " / \\ | ? * or end in a dot or a space. Try another name.');
  }
  const path = join(parent.path, name);
  if (path.length > MAX_FOLDER) return refuse(`That path would be longer than ${MAX_FOLDER} characters. Pick a shorter name.`);
  if (systemFolders(platform).some((s) => isInside(s, path))) return refuse("That's a system folder. Pick one of your own.");
  try {
    mkdirSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return refuse('That folder already exists.', 'exists', 409);
    return refuse("Worklings couldn't make that folder there.", 'unwritable', 403);
  }
  return { ok: true, path };
}
