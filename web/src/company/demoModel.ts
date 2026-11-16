// The demo's changes to a company (the demo binding in demo.ts applies them): pure, so tests can check every answer,
// undo and office change the demo makes.
import {
  type Approval,
  type CompanyView,
  type DeskState,
  type DeskView,
  type Message,
  type OfficeChange,
  type PersonView,
  type Question,
  STAKEHOLDER,
  type StatusLine,
  THE_OFFICE,
  UNDO_MS,
} from '../../../src/core/company.ts';
import type { Theme } from '../../../src/core/looks.ts';
import { countWord } from '../../../src/core/now.ts';
import { checkProposal, type OrgProposal } from '../../../src/core/org.ts';
import { DEMO_LIBRARY } from '../../../src/core/demo-company.ts';
import { type Ack, STEERING_VIEW_LIMITS } from '../../../src/core/steering.ts';
import { inSentence } from '../../../src/core/studio.ts';
import { planWait } from './plan/planModel.ts';
import { checkDraft, THEME_NAMES } from './proposal/model.ts';
import { ActionError } from './types.ts';

/** How someone is named in the office's own sentences: "Kai", or "the head of design" for a role without a name. */
export function nameOf(view: Pick<CompanyView, 'people'>, id: string): string {
  if (id === STAKEHOLDER) return 'you';
  if (id === THE_OFFICE) return 'the office';
  const p = view.people.find((x) => x.id === id);
  if (!p) return 'someone';
  return p.name === p.title ? `the ${inSentence(p.title)}` : p.name;
}

export const open = (item: Pick<Question | Approval, 'answer' | 'withdrawn'>) => item.answer === null && item.withdrawn === null;

/** The counts every screen shows, from the lists: the inbox and the desks. */
export function recount(view: CompanyView): CompanyView {
  const inbox = view.questions.filter(open).length + view.approvals.filter(open).length + (view.phase === 'proposed' && view.proposal ? 1 : 0) + (planWait(view) ? 1 : 0);
  const working = view.people.filter((p) => p.desk.state === 'working' || p.desk.state === 'starting' || p.desk.state === 'stopping').length;
  const waiting = view.people.filter((p) => p.desk.state === 'waiting').length;
  return { ...view, inbox, desks: { ...view.desks, working, waiting, max: view.settings.maxDesks } };
}

export const refused = (status: number, message: string, code: string) => new ActionError(status, message, code);

export function answerIn(view: CompanyView, id: string, option: number | null, text: string, now: number): CompanyView {
  const q = view.questions.find((x) => x.id === id);
  if (!q) throw refused(404, "That question isn't in the inbox any more.", 'unknown');
  if (q.withdrawn) throw refused(409, `It was withdrawn: ${q.withdrawn.reason}`, 'conflict');
  if (q.answer) throw refused(409, 'It was answered already.', 'conflict');
  if (option !== null && (option < 0 || option >= q.options.length)) throw refused(400, 'Pick one of its options.', 'invalid');
  const words = option !== null ? (q.options[option] ?? text) : text.trim();
  if (!words) throw refused(400, 'Pick an option or write an answer.', 'invalid');
  const answer = { option, text: option !== null && text.trim() ? text.trim() : words, at: now, appliesAt: now + UNDO_MS };
  return recount({ ...view, questions: view.questions.map((x) => (x.id === id ? { ...x, answer } : x)) });
}

/** "Use the CEO's picks": every open scoping question answered with the CEO's pick, as the hub does. */
export function picksIn(view: CompanyView, now: number): CompanyView {
  const ids = view.scoping?.questions ?? [];
  const open = view.questions.filter((q) => ids.includes(q.id) && !q.answer && !q.withdrawn && q.recommended !== null);
  if (open.length === 0) throw refused(409, 'There are no open questions from the CEO to answer with its picks.', 'conflict');
  const answer = (q: Question) => ({ option: q.recommended, text: q.options[q.recommended ?? 0] ?? '', at: now, appliesAt: now + UNDO_MS });
  return recount({ ...view, questions: view.questions.map((q) => (open.includes(q) ? { ...q, answer: answer(q) } : q)) });
}

/**
 * The scoping round closes once every question has applied (`settled`): the answers go to the CEO in one message, as
 * the hub sends them. Null while any waits, or once the round has closed.
 */
export function scopedIn(view: CompanyView, now: number, settled: ReadonlySet<string>): { view: CompanyView; prototype: boolean } | null {
  const round = view.scoping;
  if (view.phase !== 'founding' || !round || round.answeredAt !== null) return null;
  const asked = round.questions.map((id) => view.questions.find((q) => q.id === id)).filter((q): q is Question => q !== undefined);
  if (asked.some((q) => !q.withdrawn && !settled.has(q.id))) return null;
  const answered = asked.filter((q) => q.answer && !q.withdrawn);
  if (answered.length === 0) return null;
  const words = (q: Question) => (q.answer?.option !== null && q.answer?.option !== undefined ? (q.options[q.answer.option] ?? '') : `In their own words: ${q.answer?.text ?? ''}`);
  const text = ['Answers to your scoping questions:', ...answered.map((q, i) => `${i + 1}. ${q.text}\n   ${words(q)}`)].join('\n');
  const m: Message = { id: `scoped-${now}`, from: STAKEHOLDER, to: 'ceo', text, origin: null, relayOf: null, note: null, at: now, deliveredAt: now, interrupt: false, fromOffice: true };
  const n = answered.length;
  const prototype = answered.some((q) => q.answer?.option !== null && q.answer?.option !== undefined && q.options[q.answer.option] === 'A quick prototype');
  return {
    view: recount({
      ...view,
      scoping: { ...round, answeredAt: now },
      messages: [...view.messages, m],
      log: [...view.log, { at: now, kind: 'scoping', by: STAKEHOLDER, text: `You answered the CEO's ${n === 1 ? 'question' : `${countWord(n)} questions`}; it drafts the org from your answers.` }],
    }),
    prototype,
  };
}

export function decideIn(view: CompanyView, id: string, decision: 'allow' | 'deny', always: boolean, note: string | null, now: number): CompanyView {
  const a = view.approvals.find((x) => x.id === id);
  if (!a) throw refused(404, "That request isn't in the inbox any more.", 'unknown');
  if (a.withdrawn) throw refused(409, `It was withdrawn: ${a.withdrawn.reason}`, 'conflict');
  if (a.answer) throw refused(409, 'It was answered already.', 'conflict');
  if (always && (decision === 'deny' || !a.alwaysRule)) throw refused(400, 'Always is for allowing what this company may do without asking.', 'invalid');
  const answer = { decision, always, at: now, appliesAt: now + UNDO_MS, note };
  return recount({ ...view, approvals: view.approvals.map((x) => (x.id === id ? { ...x, answer } : x)) });
}

/** Takes an answer or a decision back while its undo window is open. */
export function undoIn(view: CompanyView, id: string, now: number): CompanyView {
  const q = view.questions.find((x) => x.id === id);
  const a = view.approvals.find((x) => x.id === id);
  const item = q ?? a;
  if (!item?.answer) throw refused(404, 'There is nothing to undo there.', 'unknown');
  const asker = q ? q.from : (a?.person ?? '');
  if (now >= item.answer.appliesAt) throw refused(409, `It reached ${nameOf(view, asker)} already, so it can't be undone.`, 'conflict');
  return recount({
    ...view,
    questions: view.questions.map((x) => (x.id === id ? { ...x, answer: null } : x)),
    approvals: view.approvals.map((x) => (x.id === id ? { ...x, answer: null } : x)),
  });
}

/** The questions and approvals already answered and applied: what the demo starts with, which settles nothing. */
export const answeredBy = (view: CompanyView, now: number): string[] =>
  [...view.questions, ...view.approvals].filter((x) => x.answer !== null && x.answer.appliesAt <= now).map((x) => x.id);

/**
 * What answers do once their undo window closes: the asker posts that they carry on, and "Always allow" adds its rule.
 * `settled` holds what already did. Returns the view unchanged when nothing was due.
 */
export function settle(view: CompanyView, now: number, settled: ReadonlySet<string>): { view: CompanyView; done: string[] } {
  const done: string[] = [];
  const statuses: StatusLine[] = [];
  let rules = view.settings.alwaysAllow;
  for (const q of view.questions) {
    if (!q.answer || q.answer.appliesAt > now || settled.has(q.id)) continue;
    done.push(q.id);
    // The office asks too (the "start?" before a task) but isn't anyone, so it has no status line to post.
    if (q.from !== THE_OFFICE) statuses.push({ person: q.from, text: `Got your answer: ${q.answer.text}`, taskId: q.taskId, at: q.answer.appliesAt });
  }
  for (const a of view.approvals) {
    if (!a.answer || a.answer.appliesAt > now || settled.has(a.id)) continue;
    done.push(a.id);
    const allowed = a.answer.decision === 'allow';
    statuses.push({ person: a.person, text: allowed ? `Allowed: ${inSentence(a.summary)}. Carrying on.` : `Not allowed to ${inSentence(a.summary)}; finding another way.`, taskId: null, at: a.answer.appliesAt });
    if (allowed && a.answer.always && a.alwaysRule && !rules.includes(a.alwaysRule.rule)) rules = [...rules, a.alwaysRule.rule];
  }
  if (done.length === 0) return { view, done };
  const all = [...view.statuses, ...statuses];
  return {
    view: {
      ...view,
      statuses: all,
      settings: { ...view.settings, alwaysAllow: rules },
      // Someone's status line is their newest: a line from an answer never covers a later one.
      people: view.people.map((p) => {
        const mine = statuses.filter((s) => s.person === p.id).at(-1);
        return mine && (!p.status || mine.at >= p.status.at) ? { ...p, status: mine } : p;
      }),
    },
    done,
  };
}

const themePhrase = (theme: Theme): string => (theme === 'office' ? 'a classic office' : theme === 'arcade' ? 'an arcade' : `a ${THEME_NAMES[theme]}`);

export function officeChangeIn(view: CompanyView, change: OfficeChange, decor: string[]): { view: CompanyView; decor: string[]; message: string } {
  switch (change.change) {
    case 'theme':
      return { view: { ...view, theme: change.theme }, decor, message: `The office is ${themePhrase(change.theme)} now.` };
    case 'add-room': {
      if (view.rooms.some((r) => r.id === change.room.id)) throw refused(409, `There is a room called ${change.room.title} already. Name it something else.`, 'conflict');
      return { view: { ...view, rooms: [...view.rooms, change.room] }, decor, message: `Added the room ${change.room.title}.` };
    }
    case 'remove-room': {
      const room = view.rooms.find((r) => r.id === change.room);
      if (!room) throw refused(404, "That room isn't in the office any more.", 'unknown');
      return { view: { ...view, rooms: view.rooms.filter((r) => r.id !== change.room) }, decor, message: `Removed the room ${room.title}.` };
    }
    case 'room-theme': {
      const rooms = view.rooms.map((r) => {
        if (r.id !== change.room) return r;
        if (change.theme === null) {
          const { theme: _theme, ...rest } = r;
          return rest;
        }
        return { ...r, theme: change.theme };
      });
      return { view: { ...view, rooms }, decor, message: change.theme === null ? 'The room has the office’s look again.' : `The room is ${themePhrase(change.theme)} now.` };
    }
    case 'decor': {
      // One piece goes per name removed: an office may hold two plants and lose one.
      const next = [...decor];
      for (const piece of change.remove) {
        const at = next.indexOf(piece);
        if (at >= 0) next.splice(at, 1);
      }
      next.push(...change.add);
      if (next.length > 40) throw refused(400, 'The office holds 40 pieces. Remove one to add another.', 'invalid');
      return { view, decor: next, message: change.add.length > 0 ? 'Added it. The office found it a place.' : 'Removed it.' };
    }
    case 'look': {
      if (!view.people.some((p) => p.id === change.person)) throw refused(404, "That person isn't in the company any more.", 'unknown');
      return { view: { ...view, people: view.people.map((p) => (p.id === change.person ? { ...p, look: change.look } : p)) }, decor, message: `${nameOf(view, change.person)} has a new look.` };
    }
  }
}

/** What the demo's stand-in for the hub knows of the library. */
export const DEMO_KNOWN: ReadonlySet<string> = new Set(DEMO_LIBRARY);

/** The hub's answer to an edit of the proposal, as the demo gives it: the org's own rules, the edited org's size. */
/** Takes one of the CEO's dashboards down as the hub does: gone from the view, with a line in the log. */
export function removeDashboardIn(view: CompanyView, dashboard: string, now: number): CompanyView {
  const gone = view.dashboards.find((d) => d.id === dashboard);
  if (!gone) throw refused(404, "That dashboard isn't up any more.", 'unknown');
  return {
    ...view,
    dashboards: view.dashboards.filter((d) => d.id !== dashboard),
    log: [...view.log, { at: now, kind: 'dashboard', by: STAKEHOLDER, text: `You took down the dashboard “${gone.title}”.` }],
  };
}

export function checkEdit(p: OrgProposal): { ok: true } | { ok: false; errors: string[] } {
  const check = checkProposal(p, { libraryRoles: DEMO_KNOWN, enforceSize: false });
  return check.ok ? { ok: true } : { ok: false, errors: check.errors };
}

export const closedDesk = (person: string, now: number): DeskView => ({ person, state: 'closed', sessionId: null, since: now, context: null, problem: null, queue: null });

/** The org starts: everyone in the proposal is hired, and the CEO and the heads get to work. */
export function startIn(view: CompanyView, now: number): CompanyView {
  if (view.phase !== 'proposed' || !view.proposal) throw refused(409, 'There is no proposal waiting to start.', 'conflict');
  const check = checkProposal(view.proposal, { libraryRoles: DEMO_KNOWN, enforceSize: false });
  if (!check.ok) throw refused(400, checkDraft(view.proposal)[0] ?? check.errors[0] ?? "The proposal doesn't check out.", 'invalid');
  const p = view.proposal;
  const people: PersonView[] = p.people.map((x) => {
    const before = view.people.find((v) => v.id === x.id);
    const state: DeskState = x.level === 'ceo' ? 'working' : x.level === 'head' ? 'starting' : 'closed';
    return {
      id: x.id, name: x.name, title: x.title, level: x.level, room: x.room, reportsTo: x.reportsTo, look: x.look ?? {}, model: x.model,
      desk: before ? { ...before.desk, state, since: now } : { ...closedDesk(x.id, now), state },
      task: null, status: before?.status ?? null, agentKey: before?.agentKey ?? null, cost: before?.cost ?? 0,
    };
  });
  const asked = new Set(p.questions.map((q) => q.text));
  const questions = view.questions.map((q) =>
    open(q) && q.from === 'ceo' && asked.has(q.text) ? { ...q, withdrawn: { reason: "The company started with the CEO's pick.", at: now } } : q,
  );
  return recount({
    ...view,
    questions,
    name: p.company,
    phase: 'running',
    starting: false,
    theme: p.theme,
    proposal: null,
    people,
    goal: { text: p.goal, milestones: [], setAt: now },
    log: [...view.log, { at: now, kind: 'started', by: STAKEHOLDER, text: 'You started the company. Everyone walked in.' }],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Made-up things the demo shows: a screenshot and a diff

const xml = (text: string) => text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** A phone-sized picture of the café's pickup page, with the caption on it: what a shared screenshot looks like. */
export function demoScreenshot(caption: string, dark: boolean): string {
  const ink = dark ? '#2b1a12' : '#5a4636';
  const slots = ['7:00', '7:15', '7:30', '7:45', '8:00']
    .map((t, i) => `<rect x="${20 + i * 68}" y="300" width="60" height="60" rx="12" fill="${i === 2 ? ink : '#fff'}" stroke="${ink}" stroke-width="2"/><text x="${50 + i * 68}" y="336" font-size="16" text-anchor="middle" fill="${i === 2 ? '#fff' : ink}">${t}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="375" height="812" viewBox="0 0 375 812" font-family="Barlow, Segoe UI, sans-serif">
<rect width="375" height="812" fill="#f7f0e6"/><rect width="375" height="72" fill="${ink}"/>
<text x="20" y="46" font-size="24" font-weight="600" fill="#f7f0e6">Café Lumen</text>
<text x="20" y="128" font-size="28" font-weight="600" fill="${ink}">Pick up at</text>
<text x="20" y="160" font-size="16" fill="${ink}">Today, Wednesday 5 November</text>
<rect x="20" y="190" width="335" height="80" rx="14" fill="#fff"/><text x="36" y="222" font-size="16" fill="${ink}">Flat white, croissant</text><text x="36" y="250" font-size="16" font-weight="600" fill="${ink}">CHF 9.20</text>
${slots}
<rect x="20" y="700" width="335" height="56" rx="14" fill="${ink}"/><text x="187" y="735" font-size="18" font-weight="600" text-anchor="middle" fill="#fff">Pay with TWINT</text>
<text x="20" y="420" font-size="14" fill="#7a6a5c">${xml(caption)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A unified diff for a finished task's files, made up but shaped like git's. */
export function demoDiff(files: readonly string[], commit: string): string {
  const out: string[] = [];
  files.forEach((file, i) => {
    const path = file.endsWith('/') ? `${file}index.ts` : file;
    out.push(`diff --git a/${path} b/${path}`, `index ${commit.slice(0, 7)}..${(i + 1).toString(16).padStart(7, 'f')} 100644`, `--- a/${path}`, `+++ b/${path}`, '@@ -1,6 +1,12 @@');
    out.push(' // Pickup orders for Café Lumen.', '-export const SLOT_MINUTES = 30;', '+export const SLOT_MINUTES = 15;', '+', '+/** The next slots a guest can pick, skipping full ones. */');
    out.push('+export function nextSlots(now: Date, taken: Set<string>): string[] {', '+  const out: string[] = [];', '+  return out;', '+}', ' ', ' export const OPENS = "07:00";');
  });
  return `${out.join('\n')}\n`;
}

/** What the demo's CEO can do with your words while the proposal waits: the three changes it knows. */
export function reviseProposal(p: OrgProposal, text: string): { proposal: OrgProposal; what: string } | null {
  const said = text.toLowerCase();
  if (said.includes('copywriter')) {
    if (p.people.some((x) => x.id === 'german-copywriter')) return null;
    const rooms = p.rooms.some((r) => r.id === 'content') ? p.rooms : [...p.rooms, { id: 'content', title: 'Content', style: 'content' as const }];
    const ceo = p.people.find((x) => x.level === 'ceo')?.id ?? null;
    return {
      proposal: {
        ...p,
        rooms,
        people: [...p.people, { id: 'german-copywriter', name: 'Lena', title: 'German copywriter', level: 'worker', room: 'content', reportsTo: ceo, model: 'haiku', owns: 'Every word in German, in Swiss spelling.', library: 'copywriter' }],
      },
      what: 'I added Lena, German copywriter, in a new Content room.',
    };
  }
  if (said.includes('merge') && said.includes('ux')) {
    if (!p.people.some((x) => x.id === 'ux-designer')) return null;
    return {
      proposal: { ...p, people: p.people.filter((x) => x.id !== 'ux-designer').map((x) => (x.id === 'ui-designer' ? { ...x, title: 'Product designer', owns: 'Flows, screens and the visual system.' } : x)) },
      what: 'I merged UI and UX into one product designer.',
    };
  }
  if (said.includes('fewer') || said.includes('smaller')) {
    // Two workers from the biggest rooms, so no room is left empty.
    const cut: OrgProposal['people'] = [];
    for (const x of [...p.people].reverse()) {
      if (cut.length === 2 || x.level !== 'worker' || x.id === 'office-manager') continue;
      const left = p.people.filter((y) => y.room === x.room && !cut.includes(y) && y !== x).length;
      if (left > 0) cut.push(x);
    }
    if (cut.length === 0) return null;
    return { proposal: { ...p, people: p.people.filter((x) => !cut.includes(x)) }, what: `I took out ${cut.map((x) => x.name).join(' and ')}.` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The café's slow talk: what the demo company says to itself so the live strip and the feed stay alive

/**
 * One step of a conversation. `say` is a new message, `pass` hands an earlier one of the same conversation on (its words
 * unchanged, with what the passer adds), `ack` is the receiver of an earlier one saying what they will do with it, and
 * `status` moves someone's line. `key` names a message so later steps can point at it.
 */
export type TalkStep =
  | { kind: 'say'; key: string; from: string; to: string; text: string; re?: string }
  | { kind: 'pass'; key: string; of: string; from: string; to: string; note: string }
  | { kind: 'ack'; of: string; text: string }
  | { kind: 'status'; person: string; text: string; task: string | null };

const say = (key: string, from: string, to: string, text: string, re?: string): TalkStep => ({ kind: 'say', key, from, to, text, ...(re ? { re } : {}) });
const pass = (key: string, of: string, from: string, to: string, note: string): TalkStep => ({ kind: 'pass', key, of, from, to, note });
const ack = (of: string, text: string): TalkStep => ({ kind: 'ack', of, text });
const status = (person: string, text: string, task: string | null): TalkStep => ({ kind: 'status', person, text, task });

/**
 * The conversations, played one after another and round again. Each starts from the CEO or a head, goes down the org the
 * way the café's rules allow (a person talks to their manager, their reports and their team; other teams through
 * managers) and ends in an acknowledgement and a status line. They match the café's tasks, and none of them is about
 * anything you said, so what you did yourself stays as it is.
 */
export const TALK_BEATS: readonly (readonly TalkStep[])[] = [
  [
    say('a', 'ceo', 'head-of-engineering', 'Pickup orders need a time guests can trust. Could the slot picker show only the windows the counter can serve?'),
    pass('b', 'a', 'head-of-engineering', 'web-lead', 'For the slot picker, please.'),
    pass('c', 'b', 'web-lead', 'frontend-engineer', 'Kai, this one is yours.'),
    ack('c', "Yes: I'll show only the windows with room left."),
    status('frontend-engineer', 'Showing only the pickup windows with room left.', 't-11'),
  ],
  [
    say('a', 'ceo', 'head-of-design', 'Guests should see at a glance that the café is open today. Could the menu page say so under the name?'),
    pass('b', 'a', 'head-of-design', 'ui-designer', 'Mina, could you add it to the layout?'),
    ack('b', 'Adding a line under the name: open today, and until when.'),
    status('ui-designer', "Adding today's opening hours under the café's name.", 't-24'),
  ],
  [
    say('a', 'head-of-content', 'german-copywriter', 'Pastry names stay as the café writes them: Nussgipfel, not “nut croissant”. Please keep that in the German texts.'),
    ack('a', "Yes, the café's own names first, with a short line for guests who don't know them."),
    status('german-copywriter', "Keeping the café's own pastry names in the German texts.", 't-31'),
  ],
  [
    say('a', 'backend-engineer', 'web-lead', 'The first order API call works: creating an order. Ravi can start his checks.'),
    pass('b', 'a', 'web-lead', 'head-of-engineering', 'For Ravi, please.'),
    pass('c', 'b', 'head-of-engineering', 'qa-engineer', 'Ravi, the order API is ready for your checks.'),
    ack('c', 'Starting with creating an order, then paying.'),
    status('qa-engineer', 'Checking order creation against the order API.', 't-15'),
  ],
  [
    say('a', 'ux-designer', 'head-of-design', 'The pickup flow is three steps: choose a time, pay with TWINT, show the code at the counter. Is that how you read it too?'),
    say('b', 'head-of-design', 'ux-designer', 'Yes. Keep the code big enough to scan from across the counter.', 'a'),
    ack('b', "I'll make the code large, with the pickup time above it."),
    status('ux-designer', 'Making the pickup code large enough to scan.', 't-19'),
  ],
  [
    say('a', 'head-of-engineering', 'security-reviewer', 'The payment data review can start as soon as the TWINT sandbox answers. Please read the checkout code first.'),
    ack('a', 'Reading the checkout code now.'),
    status('security-reviewer', 'Reading the checkout code before the payment review.', 't-17'),
  ],
  [
    say('a', 'local-seo-specialist', 'head-of-content', 'The menu page is in the search index, with its German and English titles.'),
    pass('b', 'a', 'head-of-content', 'ceo', 'Mara, the menu page can be found in search.'),
    ack('b', 'Good. Tell me when the order pages can be found too.'),
    status('local-seo-specialist', 'Checking how the menu page reads in search.', null),
  ],
];

/** The pace: the first conversation after this long, the next after each one ends, and a step after the one before. */
export const TALK_PACE = { first: 20_000, between: 25_000, step: 3_500 } as const;

/** What a conversation made, so the oldest can go and the loop never grows the view without end. */
export interface TalkMade {
  messages: string[];
  acks: string[];
  statuses: StatusLine[];
}

export const newMade = (): TalkMade => ({ messages: [], acks: [], statuses: [] });

/** At most this many conversations are kept; the oldest leave the feed first. */
export const TALK_KEPT = 8;

const talkPeople = (beat: readonly TalkStep[]): string[] => [...new Set(beat.flatMap((s) => (s.kind === 'say' || s.kind === 'pass' ? [s.from, s.to] : s.kind === 'status' ? [s.person] : [])))];

/** Whether the company can play a conversation: it runs, it isn't paused, and everyone in it is there and not away. */
export function talkReady(view: Pick<CompanyView, 'phase' | 'pause' | 'people'>, beat: readonly TalkStep[]): boolean {
  if (view.phase !== 'running' || view.pause) return false;
  return talkPeople(beat).every((id) => {
    const p = view.people.find((x) => x.id === id);
    return p !== undefined && p.desk.state !== 'away';
  });
}

/**
 * Plays one step: only adds (a message, an acknowledgement, a status line) and never changes what is there, so
 * nothing you said, answered or decided is touched. `keys` holds the ids of the conversation's messages by key.
 */
export function talkStep(view: CompanyView, step: TalkStep, keys: Map<string, string>, made: TalkMade, ids: { message: () => string; ack: () => string }, now: number): CompanyView {
  if (step.kind === 'say' || step.kind === 'pass') {
    const original = step.kind === 'pass' ? view.messages.find((m) => m.id === keys.get(step.of)) : undefined;
    if (step.kind === 'pass' && !original) return view;
    const desk = view.people.find((p) => p.id === step.to)?.desk.state;
    const busy = desk === 'working' || desk === 'starting' || desk === 'stopping';
    const re = step.kind === 'say' && step.re ? keys.get(step.re) : undefined;
    const m: Message = {
      id: ids.message(),
      from: step.from,
      to: step.to,
      text: original ? original.text : step.kind === 'say' ? step.text : '',
      origin: original ? (original.origin ?? original.from) : null,
      relayOf: original?.id ?? null,
      note: original && step.kind === 'pass' ? step.note : null,
      at: now,
      deliveredAt: now,
      interrupt: false,
      audience: null,
      for: [],
      deliveredHow: busy ? 'next-step' : 'new-turn',
      cites: re ? [re] : [],
    };
    keys.set(step.key, m.id);
    made.messages.push(m.id);
    return { ...view, messages: [...view.messages, m] };
  }
  if (step.kind === 'ack') {
    const m = view.messages.find((x) => x.id === keys.get(step.of));
    const steering = view.steering;
    if (!m || !steering) return view;
    const a: Ack = { id: ids.ack(), message: m.id, by: m.to, agree: true, text: step.text, at: now };
    made.acks.push(a.id);
    return { ...view, steering: { ...steering, acks: [...steering.acks, a].slice(-STEERING_VIEW_LIMITS.acks) } };
  }
  const line: StatusLine = { person: step.person, text: step.text, taskId: step.task, at: now, cites: [] };
  made.statuses.push(line);
  return { ...view, statuses: [...view.statuses, line], people: view.people.map((p) => (p.id === step.person ? { ...p, status: line } : p)) };
}

/** Takes a finished conversation out of the feed: its messages, their acknowledgements and its status lines. */
export function talkForget(view: CompanyView, made: TalkMade): CompanyView {
  const messages = new Set(made.messages);
  const acks = new Set(made.acks);
  const lines = new Set(made.statuses);
  const steering = view.steering;
  return {
    ...view,
    messages: view.messages.filter((m) => !messages.has(m.id)),
    statuses: view.statuses.filter((l) => !lines.has(l)),
    steering: steering ? { ...steering, acks: steering.acks.filter((a) => !acks.has(a.id)) } : steering,
  };
}
