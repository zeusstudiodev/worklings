// v0.7 (SPEC-v0.7.md, "Granularity"): what a plain desk's stream says about its own structure, read without changing
// it. The session's todo list (TodoWrite, or the task tools TaskCreate and TaskUpdate) becomes the task board; each
// subagent it starts with the Agent tool becomes a helper beside its desk, priced from its own requests' usage. Pure, with
// no Node APIs: the switchboard reads lines with it and the company keeps the result.
import type { DeskWork, HelperView, TodoItem } from './plain.ts';
import { costOf } from './pricing.ts';
import { totalTokens, usageFromApi } from './usage.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const ID = /^[\w.:-]{1,200}$/;
const idOf = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);

/** The most items a list is kept to, and how long one item's words may be. */
export const WORK_LIMITS = { todos: 60, todoText: 200, helpers: 40, description: 200 } as const;

export type WorkSignal =
  | { kind: 'todos'; items: TodoItem[] }
  | { kind: 'task-create'; toolUseId: string; text: string }
  | { kind: 'task-made'; toolUseId: string; taskId: string }
  | { kind: 'task-update'; taskId: string; status: TodoItem['status'] | 'deleted' | null; text: string | null }
  | { kind: 'helper-start'; toolUseId: string; type: string; description: string; taskId?: string }
  | { kind: 'helper-end'; toolUseId: string; ok: boolean }
  /** task_updated, which names the task rather than its Agent call. */
  | { kind: 'helper-update'; taskId: string; ok: boolean }
  /** The desk's process is gone, and its helpers with it. */
  | { kind: 'desk-gone'; failed: boolean }
  | { kind: 'helper-usage'; toolUseId: string; messageId: string; model: string; usage: unknown };

const STATUSES = new Set(['pending', 'in_progress', 'completed']);
const statusOf = (v: unknown): TodoItem['status'] | null => (typeof v === 'string' && STATUSES.has(v) ? (v as TodoItem['status']) : null);

/** The signals in one stream-json line of a desk; none for most lines. Never throws. */
export function workSignals(line: unknown): WorkSignal[] {
  if (!isObj(line)) return [];
  const out: WorkSignal[] = [];
  if (line.type === 'system') {
    // A task that ends without a notification still says so in task_updated's patch.
    const patch = isObj(line.patch) ? line.patch : null;
    const updated = line.subtype === 'task_updated' ? idOf(line.task_id) : null;
    if (updated && patch && ['completed', 'failed', 'killed', 'stopped'].includes(String(patch.status))) return [{ kind: 'helper-update', taskId: updated, ok: patch.status === 'completed' }];
    const toolUseId = idOf(line.tool_use_id);
    if (!toolUseId) return [];
    // A subagent's task names its type; a background shell's (task_type local_bash) is not a helper.
    if (line.subtype === 'task_started' && (typeof line.subagent_type === 'string' || line.task_type === 'local_agent')) {
      out.push({ kind: 'helper-start', toolUseId, type: text(line.subagent_type, 60) ?? 'helper', description: text(line.description, WORK_LIMITS.description) ?? '', ...(idOf(line.task_id) ? { taskId: idOf(line.task_id) ?? '' } : {}) });
    } else if (line.subtype === 'task_notification') {
      out.push({ kind: 'helper-end', toolUseId, ok: line.status === 'completed' });
    }
    return out;
  }
  if (line.type !== 'assistant' && line.type !== 'user') return [];
  const message = isObj(line.message) ? line.message : null;
  const parent = idOf(line.parent_tool_use_id);
  if (parent !== null) {
    // A subagent's own request: its usage is the helper's cost. Each request's id is counted once.
    const messageId = message ? idOf(message.id) : null;
    const model = message ? text(message.model, 100) : null;
    if (line.type === 'assistant' && messageId && model && isObj(message?.usage)) out.push({ kind: 'helper-usage', toolUseId: parent, messageId, model, usage: message.usage });
    return out;
  }
  const blocks = message && Array.isArray(message.content) ? message.content : [];
  for (const block of blocks) {
    if (!isObj(block)) continue;
    if (line.type === 'assistant' && block.type === 'tool_use' && isObj(block.input)) {
      const input = block.input;
      if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
        const items = input.todos.slice(0, WORK_LIMITS.todos).flatMap((t, i): TodoItem[] => {
          const words = isObj(t) ? text(t.content, WORK_LIMITS.todoText) : null;
          const status = isObj(t) ? statusOf(t.status) : null;
          return words && status ? [{ id: String(i + 1), text: words, status }] : [];
        });
        out.push({ kind: 'todos', items });
      } else if (block.name === 'TaskCreate') {
        const toolUseId = idOf(block.id);
        const words = text(input.subject, WORK_LIMITS.todoText) ?? text(input.description, WORK_LIMITS.todoText);
        if (toolUseId && words) out.push({ kind: 'task-create', toolUseId, text: words });
      } else if (block.name === 'TaskUpdate') {
        const taskId = idOf(String(input.taskId ?? ''));
        const status = input.status === 'deleted' ? 'deleted' : statusOf(input.status);
        if (taskId) out.push({ kind: 'task-update', taskId, status, text: text(input.subject, WORK_LIMITS.todoText) });
      }
    }
  }
  // The task tools answer with the new task's id, which later updates name.
  if (line.type === 'user' && isObj(line.tool_use_result) && isObj(line.tool_use_result.task)) {
    const taskId = idOf(String(line.tool_use_result.task.id ?? ''));
    const result = blocks.find((b) => isObj(b) && b.type === 'tool_result');
    const toolUseId = isObj(result) ? idOf(result.tool_use_id) : null;
    if (taskId && toolUseId) out.push({ kind: 'task-made', toolUseId, taskId });
  }
  return out;
}

/** A desk's work as the office keeps it, with what it needs to fold later signals in. */
export interface WorkBook {
  work: DeskWork;
  /** TaskCreate calls waiting for their id: tool_use id to the item's words. */
  creating: Map<string, string>;
  /** Request ids already priced, per helper. */
  priced: Set<string>;
  /** A subagent's task id to its Agent call, for task_updated. */
  tasks: Map<string, string>;
}

export const emptyWorkBook = (): WorkBook => ({ work: { todos: [], helpers: [] }, creating: new Map(), priced: new Set(), tasks: new Map() });

/** Folds one signal into a desk's work. `person` and `now` say whose it is and when, for a helper that starts. */
export function foldWork(book: WorkBook, s: WorkSignal, person: string, now: number): boolean {
  const { work } = book;
  switch (s.kind) {
    case 'todos':
      work.todos = s.items;
      return true;
    case 'task-create':
      book.creating.set(s.toolUseId, s.text);
      return false;
    case 'task-made': {
      const words = book.creating.get(s.toolUseId);
      book.creating.delete(s.toolUseId);
      if (words === undefined || work.todos.length >= WORK_LIMITS.todos) return false;
      work.todos = [...work.todos.filter((t) => t.id !== s.taskId), { id: s.taskId, text: words, status: 'pending' }];
      return true;
    }
    case 'task-update': {
      const at = work.todos.findIndex((t) => t.id === s.taskId);
      if (at < 0) return false;
      const status = s.status;
      if (status === 'deleted') work.todos = work.todos.filter((t) => t.id !== s.taskId);
      else work.todos = work.todos.map((t): TodoItem => (t.id === s.taskId ? { ...t, status: status ?? t.status, text: s.text ?? t.text } : t));
      return true;
    }
    case 'helper-start': {
      if (s.taskId) book.tasks.set(s.taskId, s.toolUseId);
      if (work.helpers.some((h) => h.id === s.toolUseId)) return false;
      const helper: HelperView = { id: s.toolUseId, person, type: s.type, description: s.description, state: 'working', costUsd: 0, tokens: 0, startedAt: now, endedAt: null };
      work.helpers = [...work.helpers, helper].slice(-WORK_LIMITS.helpers);
      return true;
    }
    case 'helper-end': {
      const h = work.helpers.find((x) => x.id === s.toolUseId);
      if (!h || h.state !== 'working') return false;
      h.state = s.ok ? 'done' : 'failed';
      h.endedAt = now;
      return true;
    }
    case 'helper-update': {
      const id = book.tasks.get(s.taskId);
      return id === undefined ? false : foldWork(book, { kind: 'helper-end', toolUseId: id, ok: s.ok }, person, now);
    }
    case 'desk-gone': {
      let changed = false;
      for (const h of work.helpers) {
        if (h.state !== 'working') continue;
        h.state = s.failed ? 'failed' : 'done';
        h.endedAt = now;
        changed = true;
      }
      return changed;
    }
    case 'helper-usage': {
      const h = work.helpers.find((x) => x.id === s.toolUseId);
      const key = `${s.toolUseId}/${s.messageId}`;
      if (!h || book.priced.has(key)) return false;
      book.priced.add(key);
      const usage = usageFromApi(s.usage);
      h.tokens += totalTokens(usage);
      h.costUsd += costOf(s.model, usage) ?? 0;
      return true;
    }
  }
}

/** A copy for a view, so nothing outside changes the book. */
export const workView = (book: WorkBook): DeskWork => ({ todos: book.work.todos.map((t) => ({ ...t })), helpers: book.work.helpers.map((h) => ({ ...h })) });
