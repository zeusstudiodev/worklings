// Everything under /api/c/<id>/: the stakeholder's actions on one company, its diffs, screenshots and earlier
// messages, and v2's API for the office that watches its folder. Inputs are checked here (shapes and LIMITS); the
// company checks the org's rules and refuses with a sentence (OrgRefusal), sent as it is: 403 for not-allowed, 409 for
// conflict, 400 otherwise.
import { lstat, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { ReshapeResult } from '../core/snapshot.ts';
import { LIMITS, MESSAGE_PAGE, type MessagePage, type OfficeChange, STAKEHOLDER } from '../core/company.ts';
import { safeId } from '../core/events.ts';
import { MAX_DECOR, ROOM_KINDS, THEMES } from '../core/looks.ts';
import { MODEL_LEVELS, PRESET_IDS } from '../core/presets.ts';
import { BUDGET_LIMITS, cleanBudget } from '../core/spending.ts';
import { checkLook, type OfficeRoom, ROLE_ID, ROLE_MODELS, titleFromId } from '../core/studio.ts';
import { steeringOf } from '../orgtools/define.ts';
import { plainPath } from '../safe-fs.ts';
import { type ApiReply, HttpError, readBody, send } from '../server/http.ts';
import { listSessions, transcriptDir } from '../server/replay.ts';
import { badInput, company, fields, flag, type Fields, id, MAX_COMPANY_DESKS, oneOf, optionalText, optionalWhole, params, refused, text, whole } from './input.ts';
import { companySnapshot, type HubContext, type OpenSeat, possessive } from './seat.ts';
import { steeringPost } from './steering-routes.ts';

export { company, MAX_COMPANY_DESKS } from './input.ts';

/** A transcript written this recently by something other than the person's desk means their session is still open. */
export const STILL_OPEN_MS = 30_000;
const KB = 1024;
/** Screenshot ids as the company names their files in .worklings/shots/: no dots or colons, so no other file or stream. */
const SHOT = /^[A-Za-z0-9_-]{1,64}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const theme = (value: unknown, key: string) => {
  if (typeof value !== 'string' || !(THEMES as readonly string[]).includes(value)) throw badInput(`${key} must be one of ${THEMES.join(', ')}.`);
  return value as (typeof THEMES)[number];
};

function room(raw: unknown): OfficeRoom {
  const o = fields(raw, ['id', 'title', 'kind', 'theme']);
  const roomId = typeof o.id === 'string' ? o.id.trim() : '';
  if (!ROLE_ID.test(roomId)) throw badInput('room.id must be lowercase letters, digits and hyphens.');
  const kind = oneOf(o, 'kind', ROOM_KINDS);
  const title = o.title === undefined ? titleFromId(roomId) : text(o, 'title', 40);
  return { id: roomId, title, kind, ...(o.theme === undefined || o.theme === null ? {} : { theme: theme(o.theme, 'room.theme') }) };
}

/** A budget in dollars, or null for none: the amount is refused outside BUDGET_LIMITS rather than rounded into range. */
function budget(o: Fields, key: 'company' | 'person'): number | null {
  const value = o[key];
  if (value === null) return null;
  const cleaned = cleanBudget(value);
  if (cleaned === null) throw badInput(`${key} must be a dollar amount from $${BUDGET_LIMITS.min} to $${BUDGET_LIMITS.max.toLocaleString('en-US')}, or null for none.`);
  return cleaned;
}

function pieces(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DECOR || !value.every((d) => typeof d === 'string' && ROLE_ID.test(d))) {
    throw badInput(`${key} must be a list of up to ${MAX_DECOR} decor ids like "plants".`);
  }
  return value as string[];
}

/** An office change from the Customize panel, in the shape `change_office` takes. */
export function officeChange(body: unknown): OfficeChange {
  const kinds = ['theme', 'add-room', 'remove-room', 'room-theme', 'decor', 'look'] as const;
  const kind = oneOf(fields(body, ['change', 'theme', 'room', 'add', 'remove', 'person', 'look']), 'change', kinds);
  switch (kind) {
    case 'theme':
      return { change: kind, theme: theme(fields(body, ['change', 'theme']).theme, 'theme') };
    case 'add-room':
      return { change: kind, room: room(fields(body, ['change', 'room']).room) };
    case 'remove-room':
      return { change: kind, room: id(fields(body, ['change', 'room']), 'room') };
    case 'room-theme': {
      const o = fields(body, ['change', 'room', 'theme']);
      return { change: kind, room: id(o, 'room'), theme: o.theme === null ? null : theme(o.theme, 'theme') };
    }
    case 'decor': {
      const o = fields(body, ['change', 'add', 'remove']);
      return { change: kind, add: pieces(o.add, 'add'), remove: pieces(o.remove, 'remove') };
    }
    case 'look': {
      const o = fields(body, ['change', 'person', 'look']);
      const errors: string[] = [];
      const look = checkLook(o.look, 'look', errors);
      if (errors.length > 0 || !look) throw badInput(errors[0] ?? 'Send the look to give them.');
      return { change: kind, person: id(o, 'person'), look };
    }
  }
}

/**
 * Bringing someone back reopens their session at their desk, so it waits while the session is still open in the
 * stakeholder's own Claude Code: its transcript written in the last 30 s, after their desk was handed over.
 */
async function refuseWhileElsewhere(ctx: HubContext, seat: OpenSeat, personId: string) {
  const view = seat.handle.view();
  const person = view.people.find((p) => p.id === personId);
  const sessionId = person?.desk.sessionId;
  if (!person || !sessionId || person.desk.state !== 'away' || safeId(sessionId) === undefined) return;
  const folders = [seat.root, ...view.tasks.flatMap((t) => (t.owner === personId && t.worktree ? [t.worktree.path] : []))];
  const known = seat.office.state.sessions[sessionId]?.transcriptPath;
  const paths = [...(known && seat.office.isTranscript(known) ? [known] : []), ...folders.map((f) => join(transcriptDir(f, ctx.claudeDir), `${sessionId}.jsonl`))];
  let written = 0;
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) written = Math.max(written, info.mtimeMs);
  }
  // Their desk's own last lines land around the hand-over; anything later is the stakeholder's Claude Code.
  if (written > person.desk.since + 2_000 && ctx.now() - written < STILL_OPEN_MS) {
    throw new HttpError(409, `Close ${possessive(person)} session in Claude Code first.`, { code: 'still-open' });
  }
}

type Post = { limit: number; run: (body: unknown) => ApiReply | Promise<ApiReply> };

function posts(ctx: HubContext, seat: OpenSeat): Record<string, Post> {
  const h = seat.handle;
  const ok = (body: unknown, status = 200): ApiReply => ({ status, body });
  const nothing = (call: () => void): Post => ({
    limit: KB,
    run: (body) => {
      fields(body, []);
      company(call);
      return ok({ ok: true });
    },
  });
  const v2 = (handler: ((body: unknown) => ApiReply) | undefined, limit: number): Post => ({
    limit,
    run: (body) => {
      if (!handler) throw new HttpError(404, 'No such endpoint.');
      return handler(body);
    },
  });
  return {
    // `typed: true` only for words the person typed in a box: those are the only ones the CEO may cite as their word.
    messages: {
      limit: 32 * KB,
      run: (body) => {
        const o = fields(body, ['to', 'text', 'typed']);
        const typed = flag(o, 'typed', false);
        return ok({ id: company(() => h.say(id(o, 'to'), text(o, 'text', LIMITS.message), typed ? { typed } : undefined)).id }, 202);
      },
    },
    stop: {
      limit: 32 * KB,
      run: (body) => {
        const o = fields(body, ['person', 'instruction', 'typed']);
        const typed = flag(o, 'typed', false);
        return ok({ id: company(() => h.stop(id(o, 'person'), text(o, 'instruction', LIMITS.message, 0), typed ? { typed } : undefined)).id }, 202);
      },
    },
    unsend: { limit: KB, run: (body) => ok(company(() => h.unsend(id(fields(body, ['message']), 'message')))) },
    undo: { limit: KB, run: (body) => ok(company(() => h.undo(id(fields(body, ['item']), 'item')))) },
    answers: {
      limit: 32 * KB,
      run: (body) => {
        const o = fields(body, ['question', 'option', 'text']);
        const option = optionalWhole(o, 'option', 0, LIMITS.options.max - 1);
        const words = optionalText(o, 'text', LIMITS.message) ?? '';
        if (option === null && words === '') throw badInput('Pick an option or write an answer.');
        return ok(company(() => h.answer(id(o, 'question'), { option, text: words })));
      },
    },
    // "Use the CEO's picks": every open scoping question answered with the CEO's pick, each with its undo window.
    'scoping/picks': {
      limit: KB,
      run: (body) => {
        fields(body, []);
        return ok(company(() => h.answerWithPicks()));
      },
    },
    // One press for a batch of asks: each question takes its asker's pick, each approval the office's recommendation.
    'inbox/batch': {
      limit: KB,
      run: (body) => ok(company(() => h.answerBatch(id(fields(body, ['batch']), 'batch')))),
    },
    approvals: {
      limit: 32 * KB,
      run: (body) => {
        const o = fields(body, ['approval', 'decision', 'always', 'note']);
        const decision = oneOf(o, 'decision', ['allow', 'deny'] as const);
        const always = flag(o, 'always', false);
        if (always && decision === 'deny') throw badInput('Always is for allowing: a denial counts once.');
        return ok(company(() => h.decide(id(o, 'approval'), { decision, always, note: optionalText(o, 'note', LIMITS.message) })));
      },
    },
    proposal: {
      limit: 512 * KB,
      run: (body) => {
        const o = fields(body, ['proposal', 'restore']);
        if (o.restore !== undefined) {
          if (o.restore !== true || o.proposal !== undefined) throw badInput("Send {restore: true} alone to go back to the CEO's version.");
          return ok({ ok: true, proposal: company(() => h.restoreProposal()) });
        }
        if (o.proposal === undefined) throw badInput('Send the proposal.');
        const result = company(() => h.editProposal(o.proposal));
        return result.ok ? ok(result) : ok({ ...result, error: result.errors[0] ?? "The proposal doesn't check out." }, 400);
      },
    },
    handover: { limit: KB, run: (body) => ok(company(() => h.handOver(id(fields(body, ['person']), 'person')))) },
    bringback: {
      limit: KB,
      run: async (body) => {
        const person = id(fields(body, ['person']), 'person');
        await refuseWhileElsewhere(ctx, seat, person);
        return ok(company(() => h.bringBack(person)));
      },
    },
    settings: {
      limit: 4 * KB,
      run: (body) => {
        const o: Fields = fields(body, ['maxDesks', 'removeRule']);
        const maxDesks = optionalWhole(o, 'maxDesks', 1, MAX_COMPANY_DESKS);
        const removeRule = optionalText(o, 'removeRule', 1_000);
        if (maxDesks === null && removeRule === null) throw badInput('Send maxDesks or removeRule.');
        return ok(company(() => h.updateSettings({ ...(maxDesks === null ? {} : { maxDesks }), ...(removeRule === null ? {} : { removeRule }) })));
      },
    },
    // v0.2's spending plan. The preset (before the start) sets the desks at once and the models by level, and with `resize`
    // (true when left out) asks the CEO to revise a proposal to it; a budget is in dollars, null clears it; models by level
    // change the settings and the proposal together. Each answers with the company's settings (models also with the proposal).
    preset: {
      limit: KB,
      run: (body) => {
        const o: Fields = fields(body, ['preset', 'resize']);
        return ok(company(() => h.setPreset(oneOf(o, 'preset', PRESET_IDS), { resize: flag(o, 'resize', true) })));
      },
    },
    budget: {
      limit: KB,
      run: (body) => {
        const o: Fields = fields(body, ['company', 'person']);
        const change: { company?: number | null; person?: number | null } = {};
        if (o.company !== undefined) change.company = budget(o, 'company');
        if (o.person !== undefined) change.person = budget(o, 'person');
        if (Object.keys(change).length === 0) throw badInput('Send company or person: a dollar amount, or null for none.');
        return ok(company(() => h.setBudget(change)));
      },
    },
    models: {
      limit: KB,
      run: (body) => {
        const o: Fields = fields(body, MODEL_LEVELS);
        const change: Partial<Record<(typeof MODEL_LEVELS)[number], (typeof ROLE_MODELS)[number]>> = {};
        for (const level of MODEL_LEVELS) if (o[level] !== undefined) change[level] = oneOf(o, level, ROLE_MODELS);
        if (Object.keys(change).length === 0) throw badInput(`Send the model for a level: ${MODEL_LEVELS.join(', ')}.`);
        return ok(company(() => h.setModels(change)));
      },
    },
    'dashboards/remove': { limit: KB, run: (body) => ok(company(() => h.removeDashboard(STAKEHOLDER, id(fields(body, ['dashboard']), 'dashboard')))) },
    seen: {
      limit: KB,
      run: (body) => {
        const person = id(fields(body, ['person']), 'person');
        company(() => h.markSeen(person));
        return ok(undefined, 204);
      },
    },
    // v0.2: the stakeholder has the company open (since you last looked); the company keeps one a minute at most.
    looked: {
      limit: KB,
      run: (body) => {
        fields(body, []);
        company(() => h.markLooked());
        return ok(undefined, 204);
      },
    },
    start: nothing(() => h.start()),
    pause: nothing(() => h.pause()),
    resume: nothing(() => h.resume()),
    office: { limit: 16 * KB, run: (body) => ok(company(() => h.changeOffice(STAKEHOLDER, officeChange(body)))) },
    preview: {
      limit: KB,
      run: async (body) => {
        const action = oneOf(fields(body, ['action']), 'action', ['start', 'stop'] as const);
        await (action === 'start' ? ctx.previews.start(seat.id, seat.root) : ctx.previews.stop(seat.id));
        return ok(ctx.previews.view(seat.id));
      },
    },
    // The org chart's hire, fire, move and rehire are the company's own operations (team reloaded, a decision with its
    // Undo, the CEO told); a model or a rule is a file edit, which v2's office makes.
    reshape: {
      limit: 256 * KB,
      run: async (body) => {
        const o = fields(body, ['action', 'role', 'department', 'reportsTo', 'model', 'rule']);
        const action = oneOf(o, 'action', ['hire', 'fire', 'move', 'rehire', 'model', 'rule'] as const);
        if (action === 'model' || action === 'rule') {
          if (!seat.api.reshape) throw new HttpError(404, 'No such endpoint.');
          return ok(await seat.api.reshape(body));
        }
        const roleId = (key: string, value: unknown): string => {
          if (typeof value !== 'string' || !ROLE_ID.test(value)) throw badInput(`${key} must be a lowercase id like "qa-engineer".`);
          return value;
        };
        const role = roleId('role', o.role);
        const room = o.department === undefined ? undefined : roleId('department', o.department);
        const manager = o.reportsTo === undefined ? undefined : roleId('reportsTo', o.reportsTo);
        // Say so for any field this action doesn't take, rather than dropping it: model and rule are the file edits above.
        const unused = [
          'model', 'rule',
          ...(action === 'hire' ? [] : ['reportsTo']),
          ...(action === 'hire' || action === 'move' ? [] : ['department']),
        ].filter((k) => o[k] !== undefined);
        if (unused.length > 0) throw badInput(`${action} doesn't take ${unused[0]}.`);
        // The answer is the chart's sentence, as the demo company words it; the files are the Undo's business.
        const nameOf = (who: string | null | undefined) => (who ? h.view().people.find((p) => p.id === who)?.name : undefined) ?? 'the CEO';
        const said = (result: ReshapeResult, words: () => string): ReshapeResult => (result.ok ? { ...result, message: words() } : result);
        switch (action) {
          case 'hire': {
            const result = company(() => h.hire(STAKEHOLDER, { role, name: null, title: null, ...(room ? { room } : {}), ...(manager ? { reportsTo: manager } : {}) }));
            return ok(said(result, () => `${nameOf(role)} joined, reporting to ${nameOf(h.view().people.find((p) => p.id === role)?.reportsTo)}.`));
          }
          case 'fire': {
            const before = h.view().people.find((p) => p.id === role);
            const name = nameOf(role);
            const boss = nameOf(before?.reportsTo);
            return ok(said(company(() => h.fire(STAKEHOLDER, role)), () => `${name} was fired. Their task goes back to ${boss}.`));
          }
          case 'rehire': {
            const result = company(() => h.rehire(STAKEHOLDER, role));
            return ok(said(result, () => `${nameOf(role)} is back at their desk.`));
          }
          case 'move': {
            if (!room) throw badInput('Send department: the room to move them to.');
            return ok(company(() => h.move(STAKEHOLDER, { role, room, reportsTo: null })));
          }
        }
      },
    },
    ask: v2(seat.api.ask, 4 * KB),
    'catch-up': v2(seat.api.catchUp, KB),
    'aside/cancel': v2(seat.api.cancelAside, KB),
    replay: {
      limit: KB,
      run: () => {
        throw new HttpError(404, "Replays play in an office of their own, so the company keeps working: run `worklings replay` in the company's folder.", { code: 'not-here' });
      },
    },
  };
}

async function screenshot(seat: OpenSeat, shot: string, res: ServerResponse) {
  if (!SHOT.test(shot) || !seat.handle.view().screenshots.some((s) => s.id === shot)) throw new HttpError(404, 'No such screenshot.');
  const file = plainPath(seat.root, join('.worklings', 'shots', `${shot}.png`));
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.size > LIMITS.screenshot) throw new HttpError(404, 'No such screenshot.');
  const png = await readFile(file);
  if (!png.subarray(0, PNG.length).equals(PNG)) throw new HttpError(404, 'No such screenshot.');
  res.writeHead(200, {
    'content-type': 'image/png', 'content-length': String(png.length), 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
    'cache-control': 'private, max-age=86400', 'referrer-policy': 'no-referrer',
  });
  res.end(png);
}

/** A task's diff as the company reads it from git (masked and capped there), sent as text. */
async function diff(seat: OpenSeat, taskId: string, res: ServerResponse) {
  if (safeId(taskId) === undefined) throw new HttpError(404, 'No such task.');
  let patch: string;
  try {
    patch = await seat.handle.diff(taskId);
  } catch (error) {
    throw refused(error);
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" });
  res.end(patch);
}

/**
 * A page of the messages the company keeps before `before`, for the feed's "Show earlier lines": `limit` of them, the
 * view's own 200 when it isn't given. The query is checked here; a message the company doesn't keep is its refusal.
 */
function earlierMessages(seat: OpenSeat, req: IncomingMessage): MessagePage {
  const query = params(new URL(req.url ?? '/', 'http://localhost').searchParams, ['before', 'limit']);
  const raw = query.get('before');
  if (raw === undefined) throw badInput('Send before: the id of the oldest message you have.');
  const before = id({ before: raw }, 'before');
  const asked = query.get('limit');
  // Only plain digits count as a number: "", "1e2", "0x10" and "5.0" are refused, not read the way Number() would.
  const limit = asked === undefined ? MESSAGE_PAGE.default : whole({ limit: /^\d{1,4}$/.test(asked) ? Number(asked) : asked }, 'limit', 1, MESSAGE_PAGE.max);
  return company(() => seat.handle.earlierMessages(before, limit));
}

/** Serves `rest`, the path under /api/c/<id>/, for an open company. */
export async function companyRoute(ctx: HubContext, seat: OpenSeat, req: IncomingMessage, res: ServerResponse, rest: string): Promise<void> {
  const parts = rest.split('/');
  if (req.method === 'GET') {
    if (rest === 'state') return send(res, 200, companySnapshot(seat, ctx.previews));
    if (rest === 'studio' && seat.api.studio) return send(res, 200, seat.api.studio());
    if (rest === 'sessions') return send(res, 200, listSessions(seat.root, transcriptDir(seat.root, ctx.claudeDir)));
    if (rest === 'messages') return send(res, 200, earlierMessages(seat, req));
    if (parts.length === 3 && parts[0] === 'tasks' && parts[2] === 'diff') return diff(seat, parts[1] ?? '', res);
    if (parts.length === 2 && parts[0] === 'screenshots') return screenshot(seat, parts[1] ?? '', res);
  }
  if (req.method === 'POST') {
    // Steering's routes, for a company that serves steering; its settings route takes every SettingsChange.
    const steering = steeringOf(seat.handle);
    const route = posts(ctx, seat);
    const post = (steering ? steeringPost(steering, () => seat.handle.view().settings, rest) : null) ?? (Object.hasOwn(route, rest) ? route[rest] : undefined);
    if (post) {
      const reply = await post.run(await readBody(req, post.limit));
      if (reply.status === 204) {
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      return send(res, reply.status, reply.body);
    }
  }
  throw new HttpError(404, 'No such endpoint.');
}
