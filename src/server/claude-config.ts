// What the user's own Claude Code has installed and which of their safety settings a lean desk must carry, read from
// Claude Code's own files and never from its credentials: the settings JSON (~/.claude/settings.json), the MCP servers
// in ~/.claude.json (the ones the user added to their account), the plugins the user enabled and the skills folder.
//
// Two views of the same files. The catalogue (`readInstalled`) is what the CEO and the proposal see: names, one line each
// and how they run, never a command, an address, a header or an environment value, since any of those may hold a token.
// The configs (`serverConfigs`) go only into one desk's own --mcp-config file in its temporary folder, the way the org
// tools' server does, and are never logged. Not offered: a project's own .mcp.json (Claude Code asks the user before it
// trusts one, and a file handed over with --mcp-config would skip that question) and the servers Claude Code keeps per
// folder (a desk may work in a worktree, which is another folder, and the proposal is checked without one).
//
// Everything read is untrusted: each field is checked, sized and cut to the shapes Claude Code takes, and an
// unreadable or odd file is skipped with a note (a sentence that names the file, never its content).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MCP_NAME } from '../core/loads.ts';

/** The key the org tools' server has in every desk's --mcp-config (the harness's ORG_SERVER); no other server may take it. */
export const RESERVED_KEY = 'org';

/**
 * Whether a server's name would make its tools read like the org tools' (mcp__org__...): its cleaned form is `org` or starts
 * with `org_` ("org__x" would, and "org_x" is one underscore from it). Such a server is never offered.
 */
export const reservedName = (name: string): boolean => /^org(?:_|$)/.test(name.replace(/[^A-Za-z0-9_-]/g, '_'));

/** A settings file bigger than this is not read: Claude Code's own are a few KB, and ~/.claude.json a few hundred. */
const FILE_LIMIT = 8 * 1024 * 1024;

/** Where Claude Code keeps the user's files: CLAUDE_CONFIG_DIR, else ~/.claude (and ~/.claude.json beside the home). */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.CLAUDE_CONFIG_DIR;
  if (typeof set === 'string' && set.trim() !== '') return resolve(set.trim());
  return join(homeOf(env), '.claude');
}

function homeOf(env: NodeJS.ProcessEnv): string {
  return env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
}

/** ~/.claude.json: inside CLAUDE_CONFIG_DIR when that is set, else next to the home folder. */
function globalConfigFile(env: NodeJS.ProcessEnv): string {
  const set = env.CLAUDE_CONFIG_DIR;
  return typeof set === 'string' && set.trim() !== '' ? join(resolve(set.trim()), '.claude.json') : join(homeOf(env), '.claude.json');
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max && !/\p{Cc}/u.test(v) ? v : null);

/** Reads and parses a JSON file; null with a note when it is missing (no note), too big or not JSON. Content never reaches a note. */
function readJson(file: string, notes: string[]): Obj | null {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return null; // not there: most users have no such file
  }
  if (size > FILE_LIMIT) {
    notes.push(`Skipped ${file}: it is bigger than ${FILE_LIMIT / 1024 / 1024} MB.`);
    return null;
  }
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (isObj(value)) return value;
    notes.push(`Skipped ${file}: it is not a JSON object.`);
  } catch {
    notes.push(`Skipped ${file}: it couldn't be read as JSON.`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Safety: what a lean desk must carry from the user's settings

/** What a lean desk carries over from the user's settings, since `--setting-sources project,local` leaves those out. */
export interface Carry {
  /** `hooks`, every event, the user's groups first and then the enabled plugins', each as written. */
  hooks: Record<string, unknown[]>;
  /** `permissions.deny` and `permissions.ask`, each rule as written. */
  deny: unknown[];
  ask: unknown[];
  /** `permissions.additionalDirectories` and `permissions.disableBypassPermissionsMode`, as written. */
  additionalDirectories: unknown[];
  disableBypassPermissionsMode: unknown;
  /** Other settings keys, as written: env, sandbox, deniedMcpServers, allowedMcpServers, disableBypassPermissionsMode. */
  extra: Record<string, unknown>;
  /** The user's default model, for a desk that names none, which would otherwise lose it. Effort is not carried: the company sets it. */
  model: string | null;
  /**
   * Whether everything above is the whole of what protects the user in their settings. False when anything couldn't be
   * carried in full: the desk then starts the standard way, where Claude Code reads the user's own settings itself.
   */
  complete: boolean;
  /** When incomplete, why, in a sentence that fits after "because": it is what the stakeholder is told. */
  problem: string | null;
  /** Sentences for the log about what was left out on purpose. Never content. */
  notes: string[];
  /**
   * The user's own CLAUDE.md, as a path for `claudeMdExcludes`. `--setting-sources project,local` leaves the user's memory
   * out, but a project folder under their home folder (a temp folder, ~/Desktop/anything) finds ~/.claude/CLAUDE.md again
   * as an ancestor's project file (13 Nov 2026: the CEO quoted it in a plan-only run), so a lean desk names it here.
   * Empty when the path holds a glob character, which would match other files too.
   */
  excludeMemory: string[];
}

/** The top-level settings keys carried as written, beside permissions and hooks. */
const CARRIED_KEYS = ['env', 'sandbox', 'deniedMcpServers', 'allowedMcpServers', 'disableBypassPermissionsMode'] as const;
/** Plugin hooks on this event inject context into a session, which is what a lean desk leaves out; no other plugin hook is dropped. */
const DROPPED_PLUGIN_EVENTS = new Set(['SessionStart']);

type Read = { state: 'missing' } | { state: 'ok'; value: Obj } | { state: 'bad'; why: string };

/** Reads a JSON object and says exactly what went wrong when it can't: a missing file is not a problem, an unreadable one is. */
function readStrict(file: string): Read {
  let size: number;
  try {
    size = statSync(file).size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { state: 'missing' } : { state: 'bad', why: "couldn't be opened" };
  }
  if (size > FILE_LIMIT) return { state: 'bad', why: `is bigger than ${FILE_LIMIT / 1024 / 1024} MB` };
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isObj(value) ? { state: 'ok', value } : { state: 'bad', why: 'is not a JSON object' };
  } catch {
    return { state: 'bad', why: "couldn't be read as JSON" };
  }
}

const unique = (rules: readonly unknown[]): unknown[] => {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = JSON.stringify(r);
    return !seen.has(key) && seen.add(key);
  });
};

/** `value` with the plugin's own folder put where ${CLAUDE_PLUGIN_ROOT} stands, in every string. */
function withPluginRoot(value: unknown, root: string): unknown {
  if (typeof value === 'string') return value.split('${CLAUDE_PLUGIN_ROOT}').join(root);
  if (Array.isArray(value)) return value.map((v) => withPluginRoot(v, root));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withPluginRoot(v, root)]));
  return value;
}

/** A hook that needs more of the plugin's environment than its folder, which a settings file can't give it. */
const PLUGIN_ENV = /\$\{?CLAUDE_PLUGIN_[A-Z_]+/;

/** The hooks an enabled plugin brings: its hooks/hooks.json, and `hooks` in its manifest (a map, a path or a list). */
function pluginHooks(plugin: string, root: string, carry: Carry, trouble: string[]): void {
  const maps: unknown[] = [];
  const fromFile = (path: string, optional: boolean): void => {
    const full = inside(root, path);
    const read: Read = full ? readStrict(full) : { state: 'bad', why: 'is outside the plugin' };
    if (read.state === 'ok') maps.push(isObj(read.value.hooks) ? read.value.hooks : read.value);
    else if (read.state === 'bad') trouble.push(`the ${plugin} plugin's hooks file ${read.why}`);
    else if (!optional) trouble.push(`the ${plugin} plugin's hooks file isn't there`);
  };
  fromFile('hooks/hooks.json', true);
  let manifest = readStrict(join(root, '.claude-plugin', 'plugin.json'));
  if (manifest.state === 'missing') manifest = readStrict(join(root, 'plugin.json'));
  if (manifest.state === 'bad') trouble.push(`the ${plugin} plugin's manifest ${manifest.why}`);
  const declared = manifest.state === 'ok' ? manifest.value.hooks : undefined;
  if (typeof declared === 'string') {
    if (declared.replace(/^\.\//, '') !== 'hooks/hooks.json') fromFile(declared, false);
  } else if (Array.isArray(declared)) {
    for (const item of declared) {
      if (typeof item === 'string') fromFile(item, false);
      else maps.push(item);
    }
  } else if (isObj(declared)) maps.push(declared);
  else if (declared !== undefined) trouble.push(`the ${plugin} plugin declares hooks in a form the office can't read`);
  for (const map of maps) {
    if (!isObj(map)) {
      trouble.push(`the ${plugin} plugin's hooks aren't a list of events`);
      continue;
    }
    for (const [event, groups] of Object.entries(map)) {
      if (!Array.isArray(groups)) {
        trouble.push(`the ${plugin} plugin's ${event} hooks aren't a list`);
        continue;
      }
      if (DROPPED_PLUGIN_EVENTS.has(event)) {
        carry.notes.push(`Lean desks don't run the ${plugin} plugin's ${event} hooks: they add context to a session, which a lean desk leaves out.`);
        continue;
      }
      const filled = withPluginRoot(groups, root) as unknown[];
      if (PLUGIN_ENV.test(JSON.stringify(filled))) {
        trouble.push(`the ${plugin} plugin's ${event} hook needs the plugin's own environment`);
        continue;
      }
      carry.hooks[event] = [...(carry.hooks[event] ?? []), ...filled];
    }
  }
}

/**
 * What a lean desk carries from the user's settings (~/.claude/settings.json, and the hooks of the plugins they enabled):
 * their permission rules, hooks on every event, sandbox, MCP allow and deny lists and environment, each as written. A
 * lean desk reads no user settings, so anything left behind would be a protection quietly gone. When anything can't be
 * carried in full (a file that can't be read or parsed, a shape it doesn't know, a plugin hook it can't reproduce) the
 * result says `complete: false` and why, and the caller starts the desk the standard way instead. Only settings JSON and
 * the plugins' hook files are read, never the credentials.
 */
export function readCarry(env: NodeJS.ProcessEnv = process.env): Carry {
  const carry: Carry = { hooks: {}, deny: [], ask: [], additionalDirectories: [], disableBypassPermissionsMode: undefined, extra: {}, model: null, complete: true, problem: null, notes: [], excludeMemory: [] };
  const trouble: string[] = [];
  const dir = claudeConfigDir(env);
  const memory = join(dir, 'CLAUDE.md').replaceAll('\\', '/');
  if (!/[*?[\]{}()!]/.test(memory)) carry.excludeMemory = [memory];
  const file = readStrict(join(dir, 'settings.json'));
  if (file.state === 'bad') {
    carry.complete = false;
    carry.problem = `your Claude Code settings file ${file.why}, so the office can't tell what it protects`;
    return carry;
  }
  const settings = file.state === 'ok' ? file.value : null;

  if (settings) {
    const list = (value: unknown, what: string): unknown[] => {
      if (value === undefined) return [];
      if (Array.isArray(value)) return structuredClone(value);
      trouble.push(`your ${what} isn't a list`);
      return [];
    };
    if (settings.permissions !== undefined) {
      if (isObj(settings.permissions)) {
        carry.deny = list(settings.permissions.deny, 'deny rules');
        carry.ask = list(settings.permissions.ask, 'ask rules');
        carry.additionalDirectories = list(settings.permissions.additionalDirectories, 'additional directories');
        carry.disableBypassPermissionsMode = structuredClone(settings.permissions.disableBypassPermissionsMode);
      } else trouble.push("your permissions aren't a mapping");
    }
    if (settings.hooks !== undefined) {
      if (!isObj(settings.hooks)) trouble.push("your hooks aren't a mapping of events");
      else {
        for (const [event, groups] of Object.entries(settings.hooks)) {
          if (Array.isArray(groups)) carry.hooks[event] = structuredClone(groups);
          else trouble.push(`your ${event} hooks aren't a list`);
        }
      }
    }
    if (settings.disableAllHooks === true) trouble.push("your settings turn all hooks off, which would turn the office's own off too");
    for (const key of CARRIED_KEYS) if (settings[key] !== undefined) carry.extra[key] = structuredClone(settings[key]);
    if (typeof settings.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/.test(settings.model)) carry.model = settings.model;
    for (const { plugin, root } of enabledPlugins(dir, settings, [])) pluginHooks(plugin, root, carry, trouble);
  }
  carry.deny = unique(carry.deny);
  carry.ask = unique(carry.ask);
  if (trouble.length > 0) {
    carry.complete = false;
    carry.problem = `${trouble[0] ?? ''}${trouble.length > 1 ? ` (and ${trouble.length - 1} more)` : ''}`;
  }
  return carry;
}

// ---------------------------------------------------------------------------------------------------------------------
// The catalogue: what the user has installed

/** One MCP server the user has, as the CEO and the proposal see it. */
export interface InstalledServer {
  /** The name a person's `loads.mcp` uses: "plugin:context7:context7", or the name the user gave their own server. */
  name: string;
  /** One line on what it is, for the CEO to decide by. */
  description: string;
  /** How it runs: a program on this machine, or a web address. */
  runs: 'local' | 'remote';
  source: 'user' | 'plugin';
}

export interface Installed {
  servers: InstalledServer[];
  /** Skills the user wrote themselves (~/.claude/skills). Desks never load these: see skills in src/core/loads.ts. */
  personalSkills: number;
  notes: string[];
}

interface Entry extends InstalledServer {
  /** The key it has in its own file, which an allow or deny list may name instead of the full name. */
  key: string;
  /** The server's configuration as Claude Code takes it, with its secrets: goes only into a desk's own file. */
  config: Obj;
}

const MAX_SERVERS = 60;

/** `value` with the plugin's own folder put where Claude Code's ${CLAUDE_PLUGIN_ROOT} stands. */
const withRoot = (value: string, root: string | null): string => (root === null ? value : value.split('${CLAUDE_PLUGIN_ROOT}').join(root));

const strings = (v: unknown, max: number, size: number, root: string | null): string[] | null => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || item.length > size) return null;
    out.push(withRoot(item, root));
  }
  return out;
};

const stringMap = (v: unknown, max: number, root: string | null): Record<string, string> | null => {
  if (v === undefined) return {};
  if (!isObj(v) || Object.keys(v).length > max) return null;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) {
    if (typeof value !== 'string' || value.length > 4000 || !/^[\w.-]{1,100}$/.test(k)) return null;
    out[k] = withRoot(value, root);
  }
  return out;
};

/** A server's configuration cut to the shapes Claude Code takes, or null when it isn't one of them. */
function cleanServer(raw: unknown, root: string | null): { config: Obj; runs: 'local' | 'remote' } | null {
  if (!isObj(raw)) return null;
  const type = raw.type === undefined ? 'stdio' : raw.type;
  if (type === 'http' || type === 'sse') {
    const url = text(raw.url, 2000);
    if (url === null || !/^https?:\/\//i.test(withRoot(url, root))) return null;
    const headers = stringMap(raw.headers, 30, root);
    if (headers === null) return null;
    return { config: { type, url: withRoot(url, root), ...(Object.keys(headers).length > 0 ? { headers } : {}) }, runs: 'remote' };
  }
  if (type === 'stdio') {
    const command = text(raw.command, 1000);
    const args = strings(raw.args, 100, 2000, root);
    const env = stringMap(raw.env, 50, root);
    if (command === null || args === null || env === null) return null;
    return { config: { type: 'stdio', command: withRoot(command, root), ...(args.length > 0 ? { args } : {}), ...(Object.keys(env).length > 0 ? { env } : {}) }, runs: 'local' };
  }
  return null;
}

/** The servers in a `{ name: config }` map, each as an entry named by `named`. */
function entriesOf(map: unknown, source: InstalledServer['source'], named: (key: string) => string, describe: (key: string, runs: 'local' | 'remote') => string, root: string | null, notes: string[]): Entry[] {
  if (!isObj(map)) return [];
  const out: Entry[] = [];
  for (const [key, raw] of Object.entries(map)) {
    const name = named(key);
    const clean = MCP_NAME.test(name) && !reservedName(name) ? cleanServer(raw, root) : null;
    if (clean === null) {
      notes.push(`Skipped an MCP server ${JSON.stringify(key.slice(0, 40))}: not a shape Claude Code takes, or a name the office can't use.`);
      continue;
    }
    out.push({ name, key, description: describe(key, clean.runs), runs: clean.runs, source, config: clean.config });
  }
  return out;
}

const how = (runs: 'local' | 'remote') => (runs === 'local' ? 'runs on this machine' : 'runs over the web');

/** The first sentence of a plugin's description, one line, at most 120 characters. */
function firstSentence(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/[\s\p{Cc}]+/gu, ' ').trim() : '';
  const cut = /^(.+?[.!?])(\s|$)/.exec(t)?.[1] ?? t;
  return cut.length > 120 ? `${cut.slice(0, 119).trimEnd()}…` : cut;
}

/** A file inside the plugin's folder; null for a path that leaves it. */
function inside(root: string, path: string): string | null {
  if (isAbsolute(path)) return null;
  const full = resolve(root, path);
  const rel = relative(root, full);
  return rel === '' || rel.startsWith('..') || rel.split(sep).includes('..') ? null : full;
}

/** The MCP servers one enabled plugin brings: its .mcp.json, and `mcpServers` in its manifest (a map, a path or a list). */
function pluginServers(plugin: string, root: string, notes: string[]): Entry[] {
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'), notes) ?? readJson(join(root, 'plugin.json'), notes);
  const description = firstSentence(manifest?.description);
  const describe = (_key: string, runs: 'local' | 'remote') => `${description ? `${description.replace(/[.!?]$/, '')}; ` : ''}from the ${plugin} plugin, ${how(runs)}`;
  const named = (key: string) => `plugin:${plugin}:${key}`;
  const maps: unknown[] = [];
  const fromFile = (path: string) => {
    const full = inside(root, path);
    const file = full ? readJson(full, notes) : null;
    if (file) maps.push(isObj(file.mcpServers) ? file.mcpServers : file);
  };
  fromFile('.mcp.json');
  const declared = manifest?.mcpServers;
  if (typeof declared === 'string') fromFile(declared);
  else if (Array.isArray(declared)) {
    for (const item of declared.slice(0, 5)) {
      if (typeof item === 'string') fromFile(item);
      else maps.push(item);
    }
  }
  else if (isObj(declared)) maps.push(declared);
  const seen = new Set<string>();
  return maps.flatMap((m) => entriesOf(m, 'plugin', named, describe, root, notes)).filter((e) => !seen.has(e.name) && seen.add(e.name));
}

/** The plugins the user enabled that are installed, each with the folder to read: user-scope entries first. */
function enabledPlugins(dir: string, settings: Obj | null, notes: string[]): { plugin: string; root: string }[] {
  const enabled = settings && isObj(settings.enabledPlugins) ? settings.enabledPlugins : null;
  if (!enabled) return [];
  const installed = readJson(join(dir, 'plugins', 'installed_plugins.json'), notes);
  const table = installed && isObj(installed.plugins) ? installed.plugins : null;
  if (!table) return [];
  const out: { plugin: string; root: string }[] = [];
  for (const [key, on] of Object.entries(enabled)) {
    if (on !== true) continue;
    const plugin = key.split('@')[0] ?? '';
    const records = Array.isArray(table[key]) ? (table[key] as unknown[]) : [];
    const sorted = [...records.filter(isObj)].sort((a, b) => Number(b.scope === 'user') - Number(a.scope === 'user'));
    const path = sorted.map((r) => r.installPath).find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p));
    if (MCP_NAME.test(plugin) && path) out.push({ plugin, root: resolve(path) });
  }
  return out;
}

/** Every MCP server this user could give a desk, with its configuration. Private to this module's two views. */
function scan(env: NodeJS.ProcessEnv, notes: string[]): Entry[] {
  const dir = claudeConfigDir(env);
  const global = readJson(globalConfigFile(env), notes);
  const settings = readJson(join(dir, 'settings.json'), notes);
  const identity = (key: string) => key;
  const entries: Entry[] = [];
  entries.push(...entriesOf(global?.mcpServers, 'user', identity, (key, runs) => `A server you added yourself (${key}), ${how(runs)}`, null, notes));
  for (const { plugin, root } of enabledPlugins(dir, settings, notes)) entries.push(...pluginServers(plugin, root, notes));
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.name) && seen.add(e.name) && permitted(e, settings, global)).slice(0, MAX_SERVERS);
}

/** The names an allow or deny list in the user's settings (deniedMcpServers: [{ serverName }]) or a disabled list names. */
function listed(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => (typeof v === 'string' ? [v] : isObj(v) && typeof v.serverName === 'string' ? [v.serverName] : []));
}

/** Whether the user's own lists allow a server: not denied, not disabled, and on the allow list when they keep one. */
function permitted(e: Entry, settings: Obj | null, global: Obj | null): boolean {
  const is = (names: string[]) => names.includes(e.name) || names.includes(e.key);
  if (is(listed(settings?.deniedMcpServers)) || is(listed(settings?.disabledMcpServers)) || is(listed(global?.disabledMcpServers))) return false;
  return !Array.isArray(settings?.allowedMcpServers) || is(listed(settings.allowedMcpServers));
}

/** What the user has installed, by name and one line each: no command, address, header or environment value. */
export function readInstalled(env: NodeJS.ProcessEnv = process.env): Installed {
  const notes: string[] = [];
  const servers = scan(env, notes).map(({ config: _config, ...visible }) => visible);
  let personalSkills = 0;
  try {
    const skills = join(claudeConfigDir(env), 'skills');
    personalSkills = readdirSync(skills, { withFileTypes: true }).filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(skills, d.name, 'SKILL.md'))).length;
  } catch {
    // No skills folder.
  }
  return { servers, personalSkills, notes };
}

/** The names a person's `loads.mcp` may use. */
export const installedNames = (env: NodeJS.ProcessEnv = process.env): Set<string> => new Set(readInstalled(env).servers.map((s) => s.name));

/**
 * How Claude Code spells a server in its tools' names: mcp__<this>__<tool>, with every character outside [A-Za-z0-9_-]
 * an underscore ("plugin:expo:expo" -> mcp__plugin_expo_expo__...).
 */
export function toolPrefixOf(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
}

export interface ServerConfigs {
  /**
   * name -> configuration, for a desk's --mcp-config. The key is the name as it is in the catalogue, not a cleaned one:
   * Claude Code looks up the user's sign-in to a server (OAuth) by that name, and finds none under another.
   * Holds secrets: write it only to the desk's own file.
   */
  servers: Record<string, Obj>;
  /** The names that were assigned and are no longer installed. */
  missing: string[];
}

/** The configurations of the named servers, keyed for a desk's --mcp-config. */
export function serverConfigs(names: readonly string[], env: NodeJS.ProcessEnv = process.env): ServerConfigs {
  const have = new Map(scan(env, []).map((e) => [e.name, e]));
  const servers: Record<string, Obj> = {};
  const missing: string[] = [];
  for (const name of names) {
    const entry = have.get(name);
    if (!entry || reservedName(name)) missing.push(name);
    else servers[name] = entry.config;
  }
  return { servers, missing };
}

/** The catalogue as the CEO reads it: a few lines, one per server, and what to do with them. */
export function installedInWords(installed: Installed): string {
  const lines = ['', 'What the user has installed, which you can assign to people in propose_org (loads):'];
  lines.push(
    "- tools: built-in tools; leave it out for the default (workers Read, Edit, Write, Bash, Glob, Grep; you and managers Read, Glob, Grep, Bash). Others you can add: NotebookEdit, WebFetch, WebSearch, PowerShell.",
    '- skills: true adds the Skill tool with the project\'s skills and Claude Code\'s own (about 3k tokens); the user\'s personal skills are not loaded into desks.',
  );
  if (installed.servers.length === 0) lines.push('- mcp: the user has no MCP servers installed, so there is nothing to assign.');
  else {
    lines.push('- mcp: names of MCP servers (about 1k tokens each, estimated; more for a server with many tools). Give a server only to the people whose work needs it:');
    for (const s of installed.servers) lines.push(`  - ${s.name}: ${s.description}`);
  }
  lines.push('Everyone starts lean, with only the defaults, and gets nothing they are not assigned; assign by role, not by habit.');
  return lines.join('\n');
}
