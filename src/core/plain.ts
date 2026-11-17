// v0.7 (SPEC-v0.7.md, "Parity by construction"): the plain company, Worklings' default. One unmodified Claude Code
// session works on the person's words; the office watches it and controls it, and never rewrites how it works. Pure,
// with no Node APIs: the company, the switchboard, the hub and the tests read it alike.
import type { Studio } from './studio.ts';
import { EFFORTS, type Effort } from './steering.ts';

/** The one person of a plain company: the Claude Code session at the desk. */
export const PLAIN_PERSON = 'builder';
export const PLAIN_TITLE = 'Claude Code';

/** v0.8: why a plain session's end-of-turn words leave the inbox when it goes on without a reply from the person. */
export const OWN_TURN_REASON = 'Claude Code went on by itself.';

/** How the office begins the words it puts in the inbox for a plain turn that stopped (not Claude Code's own words). */
export const TURN_STOPPED = 'The turn stopped';

/** Whether a plain turn's words are the office's note that the turn stopped. */
export const isTurnStopped = (text: string): boolean => text.startsWith(TURN_STOPPED);

/**
 * v0.8: whether a session's last words end in a question, so the inbox says "asks you" only then. The full-width and
 * Arabic question marks count; closing marks after one (a quote, a bracket, markdown's * and _, an emoji) don't.
 */
export const endsInQuestion = (text: string): boolean => /[?？؟][\s"'”’»)\]*_`\p{Extended_Pictographic}\u{FE0F}\u{200D}]*$/u.test(text.trimEnd());
const PLAIN_ROOM = 'desk';

/**
 * A plain company's studio, kept in memory only. Writing one to the project (agent files, a block in CLAUDE.md) would
 * change what the session loads, so the plain company never does.
 */
export function plainStudio(name: string): Studio {
  return {
    version: 1,
    name: name.trim() || 'The company',
    domain: 'custom',
    rigor: 'lean',
    // An office of its own, so the company's office draws the desk and the helpers beside it.
    office: { theme: 'office', rooms: [{ id: 'ceo-office', title: "Claude Code's desk", kind: 'ceo' }], decor: [] },
    departments: [{ id: PLAIN_ROOM, name: 'The desk', style: 'engineering' }],
    roles: [{ id: PLAIN_PERSON, department: PLAIN_ROOM, title: PLAIN_TITLE, level: 'ceo' }],
    rules: [],
    gates: [],
    skills: [],
    fired: [],
  };
}

/**
 * How a new company's work runs, as the start form and the CLI offer it: one Claude Code session (plain, the default) or
 * the experimental team (the solo shape: a Lead, one Builder and a strict Reviewer with a fix round).
 */
export const WORK_CHOICES = ['plain', 'team'] as const;
export type WorkChoice = (typeof WORK_CHOICES)[number];
export const isWorkChoice = (v: unknown): v is WorkChoice => typeof v === 'string' && (WORK_CHOICES as readonly string[]).includes(v);
/** The company shape a choice founds. */
export const shapeOfChoice = (choice: WorkChoice): 'plain' | 'solo' => (choice === 'team' ? 'solo' : 'plain');

/** Whether a person is a plain job's session, which the office names "Claude Code", never "the CEO". */
export const isPlainPerson = (p: { level?: string; title: string }): boolean => p.level === 'ceo' && p.title === PLAIN_TITLE;

/** Claude Code's `--permission-mode` choices (2.1.312's --help), less plan, which is the plan-first switch. */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
const isMode = (v: unknown): v is PermissionMode => typeof v === 'string' && (PERMISSION_MODES as readonly string[]).includes(v);

/** A model name Claude Code takes: an alias or a full id, never anything that reads as a flag. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

/**
 * How the job's session is launched, each left to the person's own Claude Code unless they set it for this job: what
 * plain `claude` would get from the same choices. `planFirst` starts in Claude Code's plan mode, with the plan approved
 * in the inbox (an extra, off by default).
 */
export interface PlainLaunch {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode | null;
  planFirst: boolean;
}

export const DEFAULT_LAUNCH: PlainLaunch = { model: null, effort: null, permissionMode: null, planFirst: false };

/** A plain desk's launch: the person's choices, and what is left of the job's budget (Claude Code stops at it). */
export type PlainDesk = PlainLaunch & { budgetUsd?: number | null };

/** A launch from input (the start form, the API, the log): anything unknown is left to Claude Code, never guessed. */
export function cleanLaunch(raw: unknown): PlainLaunch {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const model = typeof o.model === 'string' && MODEL_NAME.test(o.model.trim()) && o.model.trim() !== 'inherit' ? o.model.trim() : null;
  const effort = typeof o.effort === 'string' && (EFFORTS as readonly string[]).includes(o.effort) ? (o.effort as Effort) : null;
  return { model, effort, permissionMode: isMode(o.permissionMode) ? o.permissionMode : null, planFirst: o.planFirst === true };
}

/**
 * The parity contract's allowed differences between the default desk's launch and plain `claude -p` given the same
 * prompt, model, effort and permission mode (test/parity-contract.test.ts holds the launch to exactly these). None changes
 * the work: the session sees the same words, setup, tools, model, effort, mode and permission rules.
 */
export const ALLOWED_DIFFERENCES = [
  'observation: --input-format stream-json, --output-format stream-json and --verbose, so the office reads the session as it runs and can send it a message',
  'session persistence: --session-id or --resume, so a job can be resumed; the office keeps its records in .worklings/, which git ignores',
  "the office's hooks in --settings: Claude Code's own permission prompts reach the inbox (PermissionRequest), Stop and SubagentStop only tell the office what happened, and PreToolUse refuses a machine-wide kill",
  'a budget cap, kept by the office, that stops the job and never steers it',
] as const;

/** One item of the session's own todo list (TodoWrite, or the task tools TaskCreate and TaskUpdate). */
export interface TodoItem {
  /** TodoWrite's position, or the task tool's id. */
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** A subagent the session started with the Agent tool: a helper beside its desk, with its own cost. */
export interface HelperView {
  /** The Agent call's tool_use id, which its own messages name as their parent. */
  id: string;
  person: string;
  /** The subagent type ("general-purpose", "Explore"). */
  type: string;
  description: string;
  state: 'working' | 'done' | 'failed';
  /** Its own requests, priced from their usage (API-equivalent). */
  costUsd: number;
  tokens: number;
  startedAt: number;
  endedAt: number | null;
}

/** What the office shows of a plain desk's own structure, read from its stream without changing it. */
export interface DeskWork {
  todos: TodoItem[];
  helpers: HelperView[];
}
