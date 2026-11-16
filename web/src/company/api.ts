// The hub's routes (docs/architecture.md, "The hub's routes") as CompanyActions for one company, and the hub's own
// actions (starting and removing companies, the hub's desks, the folder browser). Every refusal becomes an ActionError
// carrying the office's sentence; a request that never got an answer says so in the same words everywhere.
import type { WorkChoice } from '../../../src/core/plain.ts';
import type { CompanySettings, DeskState, DeskView, Message, MessagePage, OfficeChange, PreviewView } from '../../../src/core/company.ts';
import { DESK_STATES, STAKEHOLDER } from '../../../src/core/company.ts';
import type { OrgProposal } from '../../../src/core/org.ts';
import { DEFAULT_PRESET, isPresetId, MODEL_LEVELS, presetModels } from '../../../src/core/presets.ts';
import { ROLE_MODELS } from '../../../src/core/studio.ts';
import type { ReshapeAction, ReshapeResult } from '../../../src/core/snapshot.ts';
import type { Ack } from '../../../src/core/steering.ts';
import { ActionError, type CompanyActions, type SendOptions } from './types.ts';

/** What every action says when the office didn't answer at all. */
export const OFFLINE_SENTENCE = "The office didn't answer. Try again.";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

const query = (token: string | null) => (token ? `?token=${encodeURIComponent(token)}` : '');

/** One request to the hub, answered or not: JSON in and out, the token as a bearer. steeringApi.ts sends through it too. */
export async function exchange(path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; ok: boolean; body: unknown; text: string }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ActionError(0, OFFLINE_SENTENCE, 'offline');
  }
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  return { status: res.status, ok: res.ok, body, text };
}

/** The body's `typed` field: sent only for words the person typed in a box, which the hub marks so they can be cited. */
export const typedField = (options: SendOptions | undefined): { typed?: true } => (options?.typed === true ? { typed: true } : {});

/** One call to the hub, its refusals as ActionErrors. */
async function call(path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown; text: string }> {
  const answer = await exchange(path, token, init);
  if (!answer.ok) throw refusal(answer.status, answer.body);
  return answer;
}

/** The office's sentence for a refusal, or a plain one when it gave none. */
export function refusal(status: number, body: unknown): ActionError {
  const fields = isObj(body) ? body : {};
  const code = isStr(fields.code) ? fields.code : status === 401 || status === 403 ? 'locked' : status === 404 ? 'unknown' : status === 409 ? 'conflict' : null;
  if (isStr(fields.error) && fields.error.trim()) return new ActionError(status, fields.error.trim(), code);
  const errors = strings(fields.errors);
  if (errors.length > 0) return new ActionError(status, errors.join(' '), code);
  if (status === 401 || status === 403) return new ActionError(status, 'Open the office from the link the CLI printed. It carries the access token.', code);
  return new ActionError(status, `The office turned that down (${status}). Try again.`, code);
}

function asMessage(body: unknown, fallback: Message): Message {
  if (!isObj(body)) return fallback;
  if (isStr(body.id) && isStr(body.from) && isStr(body.to) && isStr(body.text) && typeof body.at === 'number') {
    return {
      id: body.id, from: body.from, to: body.to, text: body.text, at: body.at,
      origin: isStr(body.origin) ? body.origin : null,
      relayOf: isStr(body.relayOf) ? body.relayOf : null,
      note: isStr(body.note) ? body.note : null,
      deliveredAt: typeof body.deliveredAt === 'number' ? body.deliveredAt : null,
      interrupt: body.interrupt === true,
    };
  }
  return isStr(body.id) ? { ...fallback, id: body.id } : fallback;
}

/** A change to the studio or the office as the hub answers with it, or a refusal: an answer it can't read never says it worked. */
function asReshape(body: unknown): ReshapeResult {
  if (isObj(body) && typeof body.ok === 'boolean' && isStr(body.message) && Array.isArray(body.changed) && body.changed.every(isStr)) {
    return { ok: body.ok, message: body.message, changed: body.changed };
  }
  throw new ActionError(500, "The office took it but didn't say how it went.", 'bad-answer');
}

function asPreview(body: unknown): PreviewView {
  const states = ['off', 'starting', 'up', 'down'] as const;
  const fields = isObj(body) ? body : {};
  const state = states.find((s) => s === fields.state) ?? 'off';
  return {
    state,
    url: isStr(fields.url) ? fields.url : null,
    tailnetUrl: isStr(fields.tailnetUrl) ? fields.tailnetUrl : null,
    command: isStr(fields.command) ? fields.command : null,
    problem: isStr(fields.problem) ? fields.problem : null,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = <T>(v: unknown, is: (x: unknown) => x is T): v is T | null => v === null || is(v);
const isDeskState = (v: unknown): v is DeskState => DESK_STATES.some((s) => s === v);

/** A desk as the hub answers with it, every field in place: what's missing isn't made up, the answer is refused. */
function asDesk(body: unknown): DeskView {
  if (isObj(body) && isStr(body.person) && isDeskState(body.state) && orNull(body.sessionId, isStr) && isNum(body.since) && orNull(body.context, isNum) && orNull(body.problem, isStr) && orNull(body.queue, isNum)) {
    return { person: body.person, state: body.state, sessionId: body.sessionId, since: body.since, context: body.context, problem: body.problem, queue: body.queue };
  }
  throw new ActionError(500, "The office did that but didn't say how their desk stands now.", 'bad-answer');
}

/** The company's settings as the hub answers with them, every field in place, or a refusal. */
function asSettings(body: unknown): CompanySettings {
  if (isObj(body) && isNum(body.maxDesks) && isNum(body.idleMs) && (body.billing === 'plan' || body.billing === 'api-key') && Array.isArray(body.alwaysAllow) && body.alwaysAllow.every(isStr)) {
    const models = isObj(body.models) ? body.models : {};
    const budget = isObj(body.budget) ? body.budget : {};
    const caps = (v: unknown): number | null => (isNum(v) ? v : null);
    return {
      maxDesks: body.maxDesks, idleMs: body.idleMs, billing: body.billing, alwaysAllow: body.alwaysAllow,
      preset: isPresetId(body.preset) ? body.preset : DEFAULT_PRESET,
      models: { ...presetModels(DEFAULT_PRESET), ...Object.fromEntries(MODEL_LEVELS.flatMap((l) => (isStr(models[l]) && (ROLE_MODELS as readonly string[]).includes(models[l]) ? [[l, models[l]]] : []))) },
      budget: { company: caps(budget.company), person: caps(budget.person) },
    };
  }
  throw new ActionError(500, "The office saved it but didn't say what the settings are now.", 'bad-answer');
}

/** What a feed line needs of a message; the rest of the view's fields come as the stream brings the view's own. */
const isMessage = (v: unknown): v is Message => isObj(v) && isStr(v.id) && isStr(v.from) && isStr(v.to) && isStr(v.text) && isNum(v.at);
const isAck = (v: unknown): v is Ack => isObj(v) && isStr(v.id) && isStr(v.message) && isStr(v.by) && typeof v.agree === 'boolean' && isStr(v.text) && isNum(v.at);

/** A page of earlier messages as the hub answers with it, or a refusal: an answer it can't read never ends the history. */
function asPage(body: unknown): MessagePage {
  if (isObj(body) && Array.isArray(body.messages) && body.messages.every(isMessage) && Array.isArray(body.acks) && body.acks.every(isAck) && typeof body.more === 'boolean') {
    return { messages: body.messages, acks: body.acks, more: body.more };
  }
  throw new ActionError(500, "The office sent earlier messages this page can't read. Try again.", 'bad-answer');
}

/** A company's actions bound to the hub's routes under /api/c/<id>/. */
export function liveActions(companyId: string, token: string | null): CompanyActions {
  const base = `/api/c/${encodeURIComponent(companyId)}`;
  const post = (path: string, body: unknown = {}) => call(`${base}/${path}`, token, { body });
  return {
    async say(to, text, options) {
      const { body } = await post('messages', { to, text, ...typedField(options) });
      return asMessage(body, { id: `sent-${Date.now()}`, from: STAKEHOLDER, to, text, origin: null, relayOf: null, note: null, at: Date.now(), deliveredAt: null, interrupt: false });
    },
    async unsend(message) {
      await post('unsend', { message });
    },
    async stop(person, instruction, options) {
      await post('stop', { person, instruction, ...typedField(options) });
    },
    async answer(question, option, text) {
      await post('answers', { question, option, text });
    },
    async answerWithPicks() {
      await post('scoping/picks');
    },
    async answerBatch(batch) {
      const { body } = await post('inbox/batch', { batch });
      const fields = isObj(body) ? body : {};
      const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
      return { answered: count(fields.questions) + count(fields.approvals), left: count(fields.left) };
    },
    async decide(approval, decision, always, note) {
      await post('approvals', { approval, decision, always, note });
    },
    async undo(item) {
      await post('undo', { item });
    },
    async editProposal(proposal: OrgProposal) {
      // A proposal that doesn't check out comes back as 400 with every sentence the schema had.
      const answer = await exchange(`${base}/proposal`, token, { body: { proposal } });
      if (answer.ok) return { ok: true };
      const fields = isObj(answer.body) ? answer.body : {};
      const errors = strings(fields.errors);
      if (answer.status === 400 && errors.length > 0) return { ok: false, errors };
      throw refusal(answer.status, answer.body);
    },
    async restoreProposal() {
      await post('proposal', { restore: true });
    },
    async start() {
      await post('start');
    },
    async removeDashboard(dashboard) {
      await post('dashboards/remove', { dashboard });
    },
    async pause() {
      await post('pause');
    },
    async resume() {
      await post('resume');
    },
    async changeOffice(change: OfficeChange) {
      return asReshape((await post('office', change)).body);
    },
    async reshape(action: ReshapeAction) {
      return asReshape((await post('reshape', action)).body);
    },
    async preview(action) {
      return asPreview((await post('preview', { action })).body);
    },
    async taskDiff(taskId) {
      return (await call(`${base}/tasks/${encodeURIComponent(taskId)}/diff`, token)).text;
    },
    screenshotUrl(shot) {
      return `${base}/screenshots/${encodeURIComponent(shot)}${query(token)}`;
    },
    async handOver(person) {
      return asDesk((await post('handover', { person })).body);
    },
    async bringBack(person) {
      return asDesk((await post('bringback', { person })).body);
    },
    async updateSettings(input) {
      return asSettings((await post('settings', input)).body);
    },
    async setPreset(preset) {
      return asSettings((await post('preset', { preset })).body);
    },
    async setModels(change) {
      const { body } = await post('models', change);
      return asSettings(isObj(body) ? body.settings : null);
    },
    async setBudget(change) {
      return asSettings((await post('budget', change)).body);
    },
    async markSeen(person) {
      await post('seen', { person });
    },
    async looked() {
      await post('looked', {});
    },
    async earlierMessages(before, limit) {
      const query = new URLSearchParams({ before });
      if (limit !== undefined) query.set('limit', String(limit));
      return asPage((await call(`${base}/messages?${query.toString()}`, token)).body);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The hub's own actions

/** A folder as the hub's browser reads it: its subfolders, what detection found and what to know before starting. */
export interface FolderInfo {
  /** The folder as the hub resolved it. */
  path: string;
  /** The folder it is in; null for a drive or the file system's root. */
  parent: string | null;
  folders: string[];
  /** What `detect` found there, in a sentence: "A Vite and React app." */
  detected: string | null;
  /** Things to know that don't stop a start: "Not a git repository: starting runs git init…". */
  notes: string[];
  /** Why a company can't start here, with the fix: "Café Lumen already runs here. Open it from the lobby." */
  refusal: string | null;
}

export interface HubActions {
  /** 201 {id}: the CEO starts drafting. */
  /** `work`: one Claude Code session (plain) or the experimental team. */
  createCompany(folder: string, prompt: string, work?: WorkChoice): Promise<{ id: string }>;
  /** Closes its desks and takes it out of the lobby; the folder and `.worklings/` stay. */
  removeCompany(id: string): Promise<void>;
  /** Adds a folder that already holds `.worklings/` back to the lobby (the Undo of a removal). */
  reopenCompany(folder: string): Promise<{ id: string }>;
  setHubDesks(maxDesks: number): Promise<void>;
  /**
   * One level of the folder browser; the hub's home folder when `path` is empty. `chosen`: the folder the person picked
   * for the company, the only one the hub runs git in, for notes such as uncommitted changes.
   */
  folders(path: string, options?: { chosen?: boolean }): Promise<FolderInfo>;
  /** Makes a folder and returns its path. */
  newFolder(parent: string, name: string): Promise<string>;
}

function asFolder(body: unknown, asked: string): FolderInfo {
  const fields = isObj(body) ? body : {};
  // A note may come marked as one that stops a start; plain sentences are notes.
  const notes: string[] = [];
  let refusalText: string | null = isStr(fields.refusal) ? fields.refusal : null;
  if (Array.isArray(fields.notes)) {
    for (const note of fields.notes) {
      if (isStr(note)) notes.push(note);
      else if (isObj(note) && isStr(note.text)) {
        if (note.blocks === true && !refusalText) refusalText = note.text;
        else notes.push(note.text);
      }
    }
  }
  return {
    path: isStr(fields.path) ? fields.path : asked,
    parent: isStr(fields.parent) ? fields.parent : null,
    folders: strings(fields.folders),
    detected: isStr(fields.detected) && fields.detected.trim() ? fields.detected : null,
    notes,
    refusal: refusalText,
  };
}

function asId(body: unknown): { id: string } {
  if (isObj(body) && isStr(body.id)) return { id: body.id };
  throw new ActionError(500, "The office started it but didn't say where. Open it from the lobby.", 'bad-answer');
}

export function liveHub(token: string | null): HubActions {
  return {
    async createCompany(folder, prompt, work = 'plain') {
      return asId((await call('/api/companies', token, { body: { folder, prompt, work } })).body);
    },
    async removeCompany(id) {
      await call(`/api/companies/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
    },
    async reopenCompany(folder) {
      return asId((await call('/api/companies', token, { body: { folder } })).body);
    },
    async setHubDesks(maxDesks) {
      await call('/api/hub/settings', token, { body: { maxDesks } });
    },
    async folders(path, options = {}) {
      const query = new URLSearchParams();
      if (path) query.set('path', path);
      if (options.chosen) query.set('chosen', '1');
      const q = query.toString();
      return asFolder((await call(`/api/folders${q ? `?${q}` : ''}`, token)).body, path);
    },
    async newFolder(parent, name) {
      const { body } = await call('/api/folders', token, { body: { parent, name } });
      if (isObj(body) && isStr(body.path)) return body.path;
      throw new ActionError(500, "The office made the folder but didn't say where. Browse to it.", 'bad-answer');
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Which server this is

/**
 * The hub answers `/events/lobby` with an event stream (or 401 without the token); `worklings office`, `replay` and
 * `demo` answer it with the web app's page, since v2 has no such route. One request, read up to its headers.
 */
export async function probeServer(token: string | null): Promise<'hub' | 'office' | 'unreachable'> {
  const controller = new AbortController();
  try {
    const res = await fetch(`/events/lobby${query(token)}`, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    const type = res.headers.get('content-type') ?? '';
    controller.abort();
    if (res.status === 401 || res.status === 403) return 'hub';
    return res.ok && type.includes('text/event-stream') ? 'hub' : 'office';
  } catch {
    return 'unreachable';
  }
}
