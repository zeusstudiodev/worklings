// What a person's desk loads (v0.2, "lean desks"): the built-in tools, whether the Skill tool is there, and which of the
// user's MCP servers. A person gets nothing they weren't assigned; the CEO assigns it in the proposal from what the user
// has installed, and the stakeholder edits it before the start. Pure, with no Node APIs: the proposal's form and the
// server read it alike.
import type { Level } from './studio.ts';

/**
 * The Claude Code built-ins a role may be given with `tools`. A fixed list: whatever else arrives is refused. Skill and
 * ToolSearch are never listed here, since `skills` and `mcp` add them. A desk hands work to other people through the org
 * tools; since v0.4 (SPEC-v0.4.md, H2) a Builder also splits divisible work into its own helpers with Agent, which only a
 * harness company's Builder is given by default. The task tools stay out. Checked against Claude Code 2.1.312's own
 * list (`--tools` with each name, init message): TodoWrite and LSP are not tools of a headless desk there.
 */
export const BUILTIN_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'PowerShell', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent'] as const;
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

/** What a role carries in the proposal and in studio.yaml. Every part is optional; what is missing reads as the default. */
export interface Loads {
  /** Built-in tools (BUILTIN_TOOLS). */
  tools?: string[];
  /** The Skill tool, with the project's and Claude Code's own skills. */
  skills?: boolean;
  /** Names from the installed catalogue (src/server/claude-config.ts) of MCP servers to give this person. */
  mcp?: string[];
}

/** Loads with every part decided. */
export interface ResolvedLoads {
  tools: string[];
  skills: boolean;
  mcp: string[];
}

/** Makers and checkers (checkers write tests): the six tools a desk needs to read, change and run the code. */
export const WORKER_TOOLS: readonly BuiltinTool[] = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'];
/** The CEO and managers read, search and run commands; they change the work through the org tools. */
export const MANAGER_TOOLS: readonly BuiltinTool[] = ['Read', 'Bash', 'Glob', 'Grep'];

/** The names an MCP server goes by in the catalogue: "plugin:context7:context7", "github". */
export const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,99}$/;
export const LOADS_LIMITS = { tools: BUILTIN_TOOLS.length, mcp: 12 } as const;

/** What a level gets when nothing is assigned. Also what a company from before `loads` existed reads as. */
export function defaultLoads(level: Level | undefined): ResolvedLoads {
  const manager = level === 'ceo' || level === 'head' || level === 'lead';
  return { tools: [...(manager ? MANAGER_TOOLS : WORKER_TOOLS)], skills: false, mcp: [] };
}

/** The tools in the order BUILTIN_TOOLS lists them, so the same assignment is always the same command line. */
const inOrder = (tools: Iterable<string>): string[] => {
  const given = new Set(tools);
  return BUILTIN_TOOLS.filter((t) => given.has(t));
};

/** An assignment with its gaps filled by the level's defaults. Whatever is in `loads` that isn't valid is dropped. */
export function resolveLoads(loads: Loads | null | undefined, level: Level | undefined): ResolvedLoads {
  const base = defaultLoads(level);
  if (!loads) return base;
  const tools = Array.isArray(loads.tools) ? inOrder(loads.tools.filter((t): t is string => typeof t === 'string')) : base.tools;
  const mcp = Array.isArray(loads.mcp) ? [...new Set(loads.mcp.filter((m): m is string => typeof m === 'string' && MCP_NAME.test(m)))].slice(0, LOADS_LIMITS.mcp) : base.mcp;
  return { tools, skills: typeof loads.skills === 'boolean' ? loads.skills : base.skills, mcp };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const shown = (v: unknown): string => {
  if (v === undefined || v === null) return 'nothing';
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  return String(v);
};

export interface LoadsKnown {
  /**
   * The MCP servers the user has installed, by catalogue name. When given, `mcp` may name only these; without it (the
   * browser, which can't read the user's Claude Code config) only the name's shape is checked, and the server checks the
   * rest where it writes the org.
   */
  mcp?: ReadonlySet<string> | null;
}

/**
 * Checks `loads` from outside (a proposal, studio.yaml): untrusted input. Only the known keys are kept; tool names
 * come from BUILTIN_TOOLS and MCP names from the catalogue. Errors name the field. `undefined` and null stay undefined.
 */
export function checkLoads(raw: unknown, where: string, errors: string[], known: LoadsKnown = {}): Loads | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) {
    errors.push(`${where}: expected a mapping with tools, skills or mcp`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'tools' && key !== 'skills' && key !== 'mcp') errors.push(`${where}: unknown field ${/^[\w$-]{1,40}$/.test(key) ? key : JSON.stringify(key.slice(0, 40))}; a person's loads are tools, skills and mcp`);
  }
  const loads: Loads = {};
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools) || raw.tools.length > LOADS_LIMITS.tools) errors.push(`${where}.tools: expected a list of up to ${LOADS_LIMITS.tools} tool names from ${BUILTIN_TOOLS.join(', ')}`);
    else {
      const ok: string[] = [];
      raw.tools.forEach((t: unknown, i) => {
        if (typeof t === 'string' && (BUILTIN_TOOLS as readonly string[]).includes(t)) ok.push(t);
        else if (t === 'Skill' || t === 'ToolSearch') errors.push(`${where}.tools[${i}]: ${t} comes with ${t === 'Skill' ? 'skills: true' : 'an mcp assignment'}, not from tools`);
        else errors.push(`${where}.tools[${i}]: expected one of ${BUILTIN_TOOLS.join(', ')}, got ${shown(t)}`);
      });
      loads.tools = inOrder(ok);
    }
  }
  if (raw.skills !== undefined) {
    if (typeof raw.skills === 'boolean') loads.skills = raw.skills;
    else errors.push(`${where}.skills: expected true or false, got ${shown(raw.skills)}`);
  }
  if (raw.mcp !== undefined) {
    if (!Array.isArray(raw.mcp) || raw.mcp.length > LOADS_LIMITS.mcp) errors.push(`${where}.mcp: expected a list of up to ${LOADS_LIMITS.mcp} server names from the installed catalogue`);
    else {
      const names: string[] = [];
      raw.mcp.forEach((m: unknown, i) => {
        if (typeof m !== 'string' || !MCP_NAME.test(m)) errors.push(`${where}.mcp[${i}]: expected a server name from the installed catalogue, got ${shown(m)}`);
        else if (known.mcp && !known.mcp.has(m)) errors.push(`${where}.mcp[${i}]: ${shown(m)} is not an MCP server the user has installed${known.mcp.size > 0 ? ` (installed: ${[...known.mcp].slice(0, 12).join(', ')})` : ' (none are)'}`);
        else if (!names.includes(m)) names.push(m);
      });
      loads.mcp = names;
    }
  }
  return loads;
}

/** Two assignments that load the same things, whatever order they list them in. */
export function sameLoads(a: ResolvedLoads, b: ResolvedLoads): boolean {
  return a.skills === b.skills && a.tools.join() === b.tools.join() && [...a.mcp].sort().join() === [...b.mcp].sort().join();
}

// ---------------------------------------------------------------------------------------------------------------------
// What it costs

/**
 * A desk's fixed prompt, in tokens, from `node scripts/probe-desk-prompt.mjs` on Claude Code 2.1.312 (13 Nov 2026):
 * 13.5k for a maker with `--setting-sources project,local --strict-mcp-config --tools Read,Edit,Write,Bash,Glob,Grep`,
 * against 52.9k with the user's whole setup. The CEO's org tools add about 13k (26.9k for the CEO in the same probe, 13 Nov
 * 2026) and the Skill tool 3k. An MCP server's cost
 * depends on how many tools it has, so it stays an estimate: one server with 56 tools (the Expo plugin's) added 1.8k with
 * ToolSearch, which is 600 for the tool and about 20 per deferred tool name; 1.2k a server assumes a smaller one.
 */
export const FIXED_PROMPT = { base: 13_000, ceoOrgTools: 13_000, skill: 3_000, mcpServer: 1_200, toolSearch: 600 } as const;

export interface LoadCostPart {
  what: string;
  tokens: number;
  /** true when the figure comes from a probe; false for an estimate. */
  measured: boolean;
}

export interface LoadCost {
  /** The fixed prompt's estimated size, in tokens. */
  tokens: number;
  /** False as soon as any part is an estimate. */
  measured: boolean;
  parts: LoadCostPart[];
}

/** The fixed prompt a person's desk starts every conversation with, from the probe's numbers. Pure. */
export function estimateLoads(loads: Loads | null | undefined, level: Level | undefined): LoadCost {
  const r = resolveLoads(loads, level);
  const parts: LoadCostPart[] = [{ what: 'Claude Code and the office', tokens: FIXED_PROMPT.base, measured: true }];
  if (level === 'ceo') parts.push({ what: "the CEO's org tools", tokens: FIXED_PROMPT.ceoOrgTools, measured: true });
  if (r.skills) parts.push({ what: 'skills', tokens: FIXED_PROMPT.skill, measured: true });
  if (r.mcp.length > 0) {
    parts.push({ what: 'tool search', tokens: FIXED_PROMPT.toolSearch, measured: false });
    for (const name of r.mcp) parts.push({ what: name, tokens: FIXED_PROMPT.mcpServer, measured: false });
  }
  return { tokens: parts.reduce((n, p) => n + p.tokens, 0), measured: parts.every((p) => p.measured), parts };
}
