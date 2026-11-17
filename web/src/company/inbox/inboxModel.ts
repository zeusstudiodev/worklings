// The inbox (docs/design-v3.md, "Inbox"): what needs you, oldest first, each item's lines, what an item shows after a
// press or after something else took it away, what was answered today, and the conversations. Pure, so it can be
// tested; the component keeps only this tab's own presses.
import { type Approval, type CompanyView, type Message, type PersonView, type Question, STAKEHOLDER, THE_OFFICE, UNDO_MS } from '../../../../src/core/company.ts';
import { clip, coarseAge, coarseDuration, countWord, plainText } from '../../../../src/core/now.ts';
import { endsInQuestion, isTurnStopped, OWN_TURN_REASON } from '../../../../src/core/plain.ts';
import { capital } from '../../../../src/core/words.ts';
import { hourMinute, whenAt } from '../../lib/format.ts';
import { waitsForWords } from '../pauseWords.ts';
import {
  called,
  endSentence,
  inLine,
  isOpenApproval,
  isOpenQuestion,
  managerOrNull,
  nameOf,
  possessive,
  taskOf,
  type WaitItem,
  waitAt,
  waitId,
  waitPerson,
} from '../people/peopleModel.ts';
import { answerSentence, unreadFrom } from '../person/personModel.ts';
import { whyLine } from '../proposal/model.ts';

export type Item = WaitItem;
export { waitAt as itemAt, waitId as itemId };

/** The owner of the task the office's "start?" is about: steering's "check with me" asks before each of their tasks. */
const gateOwner = (company: Pick<CompanyView, 'tasks'>, q: Question): string | null => (q.gate ? (company.tasks.find((t) => t.id === q.gate?.task)?.owner ?? null) : null);

/**
 * Who an item is about: who asks or wants your OK, or for the office's "start?" before a task, whose task it is. Null
 * when that is the office itself, whom nobody can message.
 */
export function itemPerson(company: Pick<CompanyView, 'tasks'>, item: Item): string | null {
  if (item.kind === 'question' && item.question.gate) return gateOwner(company, item.question);
  const id = waitPerson(item);
  return id === THE_OFFICE ? null : id;
}

/** Who asks, as a sentence calls them: "Mina", "the QA engineer", or "the office" for its "start?" before a task. */
export function askerCalled(company: CompanyView, item: Item): string {
  if (item.kind === 'approval') return nameOf(company, item.approval.person).called;
  return item.question.from === THE_OFFICE ? 'the office' : nameOf(company, item.question.from).called;
}

/**
 * What an answer sets going once it reaches them: "Kai carries on.", and for the office's "start?", what happens to the
 * task: its owner starts it on "Start it", and any other answer pauses it until you resume it.
 */
function carriesOn(company: CompanyView, item: Item, option: number | null): string {
  if (item.kind === 'question' && item.question.gate) {
    const owner = gateOwner(company, item.question);
    if (option !== 0) return 'The task waits until you resume it.';
    return owner ? `${capital(nameOf(company, owner).called)} starts it.` : 'The task starts.';
  }
  return `${capital(askerCalled(company, item))} carries on.`;
}

/** A box for your own words holds this many characters. */
export const OWN_WORDS_MAX = 1_000;

/** "Three need you, oldest first.", "One needs you.", "Nothing needs you." */
export function needsYouLine(n: number): string {
  if (n === 0) return 'Nothing needs you.';
  if (n === 1) return 'One needs you.';
  return `${capital(countWord(n))} need you, oldest first.`;
}

// ---------------------------------------------------------------------------------------------------------------
// An item's lines while it waits

/** Tools whose detail is a path, not a command: "Show the path". */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export interface QuestionLines {
  /** "Mina, UI designer, asks you. Ines has a copy.", or for a plain session's last words "Claude Code finished its turn." */
  who: string;
  /** "Asked 2 min ago.", or "2 min ago." for words that ask nothing. */
  asked: string;
  /** Whether it is a question to answer; a plain session's words that ask nothing take a reply instead. */
  asks: boolean;
  text: string;
  /** "For: Pickup slot picker", a link to the task. */
  task: { id: string; title: string } | null;
  options: { label: string; pick: boolean }[];
  /** The asker's reason for its pick, when it gave one (the CEO's scoping questions). */
  why: string | null;
}

/** Who asks, for a question: "Mina, UI designer, asks you. Ines has a copy.", or the office before someone's next task. */
function askedBy(company: CompanyView, q: Question): string {
  if (q.from === THE_OFFICE) {
    const owner = gateOwner(company, q);
    return q.gate && owner ? `The office asks about ${possessive(nameOf(company, owner).called)} next task.` : 'The office asks you.';
  }
  const asker = nameOf(company, q.from);
  const manager = asker.person ? managerOrNull(company, asker.person) : null;
  const copy = asker.person?.level !== 'ceo' && manager ? ` ${capital(called(manager))} has a copy.` : '';
  return `${capital(asker.subject)} asks you.${copy}`;
}

/**
 * v0.8: a plain session's words at the end of its turn: it asks you only when they end in a question; otherwise it
 * finished its turn (or the turn stopped, in the office's words), and the person may reply.
 */
function turnLines(company: CompanyView, q: Question, now: number): Pick<QuestionLines, 'who' | 'asked' | 'asks'> {
  const who = capital(nameOf(company, q.from).subject);
  const age = coarseAge(now - q.askedAt);
  if (endsInQuestion(q.text)) return { who: `${who} asks you.`, asked: `Asked ${age}.`, asks: true };
  const stopped = isTurnStopped(q.text);
  return { who: stopped ? `${possessive(who)} turn stopped.` : `${who} finished its turn.`, asked: `${capital(age)}.`, asks: false };
}

export function questionLines(company: CompanyView, q: Question, now: number): QuestionLines {
  const task = taskOf(company, q.taskId);
  return {
    ...(q.plainTurn === true ? turnLines(company, q, now) : { who: askedBy(company, q), asked: `Asked ${coarseAge(now - q.askedAt)}.`, asks: true }),
    text: plainText(q.text),
    task: task ? { id: task.id, title: clip(plainText(task.title), 120) } : null,
    options: q.options.map((label, i) => ({ label: clip(plainText(label), 120), pick: q.recommended === i })),
    why: whyLine(q),
  };
}

export interface ApprovalLines {
  /** "Kai, frontend engineer, wants your OK. Waiting 3 min." */
  who: string;
  /** "Waiting 3 min." */
  waiting: string;
  summary: string;
  task: { id: string; title: string } | null;
  /** "Show the command", or "Show the path" for a file. */
  detailLabel: string;
  detail: string;
  /** "Always allow adds a rule for this company: any git push to origin." Null where Always allow isn't offered. */
  always: string | null;
  /** "No answer by 15:20 counts as a no." */
  expires: string;
}

export function approvalLines(company: CompanyView, a: Approval, now: number): ApprovalLines {
  const who = nameOf(company, a.person);
  const task = who.person ? taskOf(company, who.person.task) : undefined;
  return {
    who: `${capital(who.subject)} wants your OK. Waiting ${coarseDuration(now - a.askedAt)}.`,
    waiting: `Waiting ${coarseDuration(now - a.askedAt)}.`,
    summary: endSentence(clip(plainText(a.summary), 200)).replace(/\.$/, ''),
    task: task ? { id: task.id, title: clip(plainText(task.title), 120) } : null,
    detailLabel: FILE_TOOLS.has(a.tool) ? 'Show the path' : 'Show the command',
    detail: a.detail,
    always: a.alwaysRule ? `Always allow adds a rule for this company: ${endSentence(plainText(a.alwaysRule.sentence).trim())}` : null,
    expires: `No answer by ${hourMinute(a.expiresAt)} counts as a no.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// After a press, or after something else took the item away

/** What this tab pressed. */
export type Answer = { kind: 'question'; option: number | null; text: string } | { kind: 'approval'; decision: 'allow' | 'deny'; always: boolean };

/**
 * This tab's press on an item. sending: the request is on its way. sent: the hub took it. undoing: Undo is on its way.
 * undone: the hub put the item back. refused: the request failed, so the item is back with why.
 */
export interface Press {
  answer: Answer;
  state: 'sending' | 'sent' | 'undoing' | 'undone' | 'refused';
  /** When it was pressed, by this browser's clock: the undo window until the hub's own time arrives. */
  at: number;
  /** Why it was refused, in the office's words. */
  error: string | null;
  /** The answer this press took back, by its time, so a later answer reads as someone else's. */
  undid: number | null;
}

export type ItemView =
  | { kind: 'open'; refusal: string | null }
  /** Pressed: one line with Undo until the answer reaches them (`until`, by this browser's clock). A denial also offers to say why. */
  | { kind: 'pending'; text: string; until: number; denial: boolean }
  /** Pressed here and gone through. */
  | { kind: 'done'; text: string; denial: boolean }
  | { kind: 'elsewhere'; text: string }
  /** Withdrawn or timed out while you looked, with "Message Kai". */
  | { kind: 'gone'; text: string }
  /** Answered before this visit: the Answered fold has it. */
  | { kind: 'answered' }
  /** Withdrawn before this visit. */
  | { kind: 'hidden' };

const answerOf = (item: Item) => (item.kind === 'question' ? item.question.answer : item.approval.answer);
const withdrawnOf = (item: Item) => (item.kind === 'question' ? item.question.withdrawn : item.approval.withdrawn);

/** Your answer in words: "Stripe", your own words cut short, "allowed once", "always allowed", "denied". */
function answerWords(item: Item, answer: { option: number | null; text: string } | { decision: 'allow' | 'deny'; always: boolean }): string {
  if ('decision' in answer) return answer.decision === 'deny' ? 'denied' : answer.always ? 'always allowed' : 'allowed once';
  const q = item.kind === 'question' ? item.question : null;
  const option = answer.option !== null && q ? q.options[answer.option] : undefined;
  return clip(plainText(option ?? answer.text), 80);
}

/** v0.8: a plain session's words that ask nothing take a reply, not an answer. */
export const takesReply = (item: Item): boolean => item.kind === 'question' && item.question.plainTurn === true && !endsInQuestion(item.question.text);

/** v0.8: a plain session's end of turn the session went on from by itself: a reply to it goes as a message. */
const wentOn = (item: Item): boolean => item.kind === 'question' && item.question.plainTurn === true && item.question.withdrawn?.reason === OWN_TURN_REASON;

/** What a press leaves in place of the item, naming who it was for: "Denying Sam.", "Answering the CEO: TWINT." */
function pendingText(company: CompanyView, item: Item, answer: Answer): string {
  const who = askerCalled(company, item);
  if (answer.kind === 'approval') return answer.decision === 'deny' ? `Denying ${who}.` : answer.always ? `Allowing ${who} always.` : `Allowing ${who} once.`;
  return `${takesReply(item) ? 'Replying to' : 'Answering'} ${who}: ${endSentence(answerWords(item, answer))}`;
}

/** What the live region says at the press, so the window to change your mind is heard too, not only the result. */
export const pressAnnouncement = (company: CompanyView, item: Item, answer: Answer): string =>
  `${pendingText(company, item, answer)} Undo is available for ${Math.round(UNDO_MS / 1000)} seconds.`;

function doneText(company: CompanyView, item: Item, at: number, answer: { option: number | null; text: string } | { decision: 'allow' | 'deny'; always: boolean; note: string | null }): string {
  const when = whenAt(at);
  if ('decision' in answer) {
    const who = capital(askerCalled(company, item));
    if (answer.decision === 'deny') return `Denied ${when}. ${who} was told ${answer.note ? 'why' : 'no'}.`;
    return `${answer.always ? 'Always allowed' : 'Allowed once'} ${when}. ${who} carries on.`;
  }
  return `${takesReply(item) ? 'Replied' : 'Answered'} ${when}: ${endSentence(answerWords(item, answer))} ${carriesOn(company, item, answer.option)}`;
}

/** Why something was taken away before you answered, as a sentence: the office's own reason, or a timed-out ask. */
function goneText(company: CompanyView, item: Item, now: number): string {
  const who = askerCalled(company, item);
  const withdrawn = withdrawnOf(item);
  if (item.kind === 'approval' && (withdrawn === null ? now >= item.approval.expiresAt : withdrawn.at >= item.approval.expiresAt)) {
    return `Timed out ${whenAt(item.approval.expiresAt)}, so ${who} was told no.`;
  }
  if (wentOn(item)) return `${capital(who)} went on by itself, so what you write goes to it as a message.`;
  const reason = withdrawn ? plainText(withdrawn.reason).trim() : '';
  return `Withdrawn: ${reason ? endSentence(capital(clip(reason, 200))) : `${capital(who)} doesn't need it any more.`}`;
}

/** The couldn't-send line, after the office's own sentence for why (which may already say to try again). */
export function refusalLine(why: string): string {
  const reason = why.trim().replace(/\s*Try again\.?$/i, '').trim();
  return `Couldn't send your answer. ${endSentence(reason || "The office didn't answer")} Try again.`;
}

/**
 * When a press stops being undoable, by this browser's clock, which UndoLine times it on: the hub's `appliesAt` moved
 * onto this clock by the skew once the snapshot has the answer, UNDO_MS from the press until then.
 */
export function undoUntil(item: Item, press: Pick<Press, 'at'>, skew: number): number {
  const answer = answerOf(item);
  return answer ? answer.appliesAt - skew : press.at + UNDO_MS;
}

/** What the inbox looks from: the office's time now, when this inbox opened, and how far the hub's clock runs ahead of this browser's. */
export interface InboxContext {
  now: number;
  openedAt: number;
  skew: number;
  /** v0.8: items whose own-words box is open with words in it; one the session went on from stays open while you write. */
  drafting?: ReadonlySet<string>;
}

/**
 * What an item shows now, from the snapshot and this tab's press. `openedAt` is the office time this inbox was opened:
 * whatever changed since stays in place as a line until you leave, and what came before goes to Answered.
 */
export function itemView(company: CompanyView, item: Item, press: Press | undefined, ctx: InboxContext): ItemView {
  const answer = answerOf(item);
  const withdrawn = withdrawnOf(item);
  const open = item.kind === 'question' ? isOpenQuestion(item.question) : isOpenApproval(item.approval, ctx.now);
  const expired = item.kind === 'approval' && ctx.now >= item.approval.expiresAt;
  const pending = (p: Press): ItemView => ({ kind: 'pending', text: pendingText(company, item, p.answer), until: undoUntil(item, p, ctx.skew), denial: isDenial(p.answer) });

  // The hub took the Undo, and the snapshot may not say so yet.
  if (press?.state === 'undone' && answer !== null && answer.at === press.undid && withdrawn === null && !expired) return { kind: 'open', refusal: null };
  // A reply being written when the session went on by itself: the item stays, and the reply goes to it as a message.
  if (wentOn(item) && press === undefined && ctx.drafting?.has(waitId(item))) return { kind: 'open', refusal: null };
  if (open) {
    if (press?.state === 'refused') return { kind: 'open', refusal: press.error };
    // Pressed, and the snapshot doesn't have the answer yet: the window runs from the press.
    if (press && (press.state === 'sending' || press.state === 'sent')) return pending(press);
    return { kind: 'open', refusal: null };
  }
  if (answer !== null) {
    if (press && (press.state === 'sending' || press.state === 'sent' || press.state === 'undoing')) {
      if (ctx.now < answer.appliesAt) return pending(press);
      return { kind: 'done', text: doneText(company, item, answer.at, answer), denial: isDenial(press.answer) };
    }
    if (answer.at >= ctx.openedAt) return { kind: 'elsewhere', text: `Answered in another window: ${answerWords(item, answer)} ${whenAt(answer.at)}.` };
    return { kind: 'answered' };
  }
  // The reply written as the session went on by itself went to it as a message (the hub's answer() delivers it so).
  if (wentOn(item) && (press?.state === 'sending' || press?.state === 'sent')) return { kind: 'gone', text: `Sent to ${askerCalled(company, item)} as a message.` };
  // Withdrawn, or an approval whose hook gave up.
  const goneAt = withdrawn?.at ?? (item.kind === 'approval' ? item.approval.expiresAt : ctx.now);
  if (goneAt >= ctx.openedAt || press !== undefined) return { kind: 'gone', text: goneText(company, item, ctx.now) };
  return { kind: 'hidden' };
}

const isDenial = (a: Answer) => a.kind === 'approval' && a.decision === 'deny';

/** Every question and approval, oldest asked first. */
export function allItems(company: Pick<CompanyView, 'questions' | 'approvals'>): Item[] {
  return [
    ...company.questions.map((question) => ({ kind: 'question' as const, question })),
    ...company.approvals.map((approval) => ({ kind: 'approval' as const, approval })),
  ].sort((x, y) => waitAt(x) - waitAt(y) || (waitId(x) < waitId(y) ? -1 : waitId(x) > waitId(y) ? 1 : 0));
}

export interface InboxView {
  /** What Needs you holds, oldest asked first: the open items and the lines left by what changed while you looked. */
  needs: { item: Item; view: Exclude<ItemView, { kind: 'answered' } | { kind: 'hidden' }> }[];
  /** How many of them are open. */
  open: number;
  answered: AnsweredRow[];
}

export interface AnsweredRow {
  id: string;
  /** The question, or what the approval asked for. */
  what: string;
  /** "Stripe", "Allowed once", "Denied". */
  answer: string;
  at: number;
}

/** Local midnight of the day `now` falls in. */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function inboxView(company: CompanyView, presses: Readonly<Record<string, Press>>, ctx: InboxContext): InboxView {
  const needs: InboxView['needs'] = [];
  const answered: AnsweredRow[] = [];
  const today = startOfDay(ctx.now);
  for (const item of allItems(company)) {
    const id = waitId(item);
    const view = itemView(company, item, Object.hasOwn(presses, id) ? presses[id] : undefined, ctx);
    if (view.kind === 'hidden') continue;
    if (view.kind === 'answered') {
      const answer = answerOf(item);
      if (!answer || answer.at < today) continue;
      answered.push({
        id,
        what: item.kind === 'question' ? clip(plainText(item.question.text), 160) : endSentence(inLine(item.approval.summary)).replace(/^./, (c) => c.toUpperCase()),
        answer: capital(answerWords(item, answer)) + (item.kind === 'question' && item.question.answer?.byDefault ? ' (the pick, since you did not answer)' : ''),
        at: answer.at,
      });
      continue;
    }
    needs.push({ item, view });
  }
  return { needs, open: needs.filter((n) => n.view.kind === 'open').length, answered: answered.sort((a, b) => b.at - a.at) };
}

/** "14 answered today", "One answered today". */
export const answeredLine = (n: number): string => `${n === 1 ? 'One' : n <= 12 ? capital(countWord(n)) : n} answered today`;

/** What the feed says in place of a pressed item once it went through: "You answered 15-minute windows at 14:07." */
export function youAnsweredLine(item: Item, answer: { option: number | null; text: string } | { decision: 'allow' | 'deny'; always: boolean }, at: number): string {
  const when = hourMinute(at);
  if ('decision' in answer) return `You ${answer.decision === 'deny' ? 'denied it' : answer.always ? 'always allowed it' : 'allowed it once'} at ${when}.`;
  return `You answered ${answerWords(item, answer).replace(/\.$/, '')} at ${when}.`;
}

/** What the live region says once your answer reaches them: "Allowed. Kai carries on." */
export function appliedAnnouncement(company: CompanyView, item: Item, answer: Answer): string {
  if (answer.kind === 'question') return `Answered. ${carriesOn(company, item, answer.option)}`;
  const who = capital(askerCalled(company, item));
  return answer.decision === 'deny' ? `Denied. ${who} was told no.` : `Allowed. ${who} carries on.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Conversations

export interface ConversationRow {
  person: PersonView;
  /** The last line: "You: …" when it was yours. */
  last: string;
  at: number;
  unread: boolean;
}

/** Everyone you have messages with, newest first, with the last line and whether anything is new since you looked. */
export function conversationsOf(company: CompanyView): ConversationRow[] {
  const latest = new Map<string, { at: number; line: string }>();
  const note = (person: string, at: number, line: string) => {
    const was = latest.get(person);
    if (!was || at >= was.at) latest.set(person, { at, line });
  };
  const shown = (text: string) => clip(plainText(text), 160);
  for (const m of company.messages as readonly Message[]) {
    // Your answer to their question says so, rather than the words it travelled in.
    if (m.from === STAKEHOLDER) note(m.to, m.at, answerSentence(company, m) ?? `You: ${shown(m.text)}`);
    else if (m.to === STAKEHOLDER) note(m.from, m.at, shown(m.text));
  }
  for (const r of company.reports) if (r.to === STAKEHOLDER) note(r.person, r.at, shown(r.text));
  const rows: ConversationRow[] = [];
  for (const [id, last] of latest) {
    const person = company.people.find((p) => p.id === id);
    if (!person) continue;
    rows.push({ person, last: clip(last.line, 200), at: last.at, unread: unreadFrom(company, id) > 0 });
  }
  return rows.sort((a, b) => b.at - a.at);
}

/** "Conversations", or "Conversations, two new". */
export function conversationsTitle(rows: readonly ConversationRow[]): string {
  const fresh = rows.filter((r) => r.unread).length;
  return fresh > 0 ? `Conversations, ${countWord(fresh)} new` : 'Conversations';
}

/**
 * The inbox opened on one item: Answer buttons elsewhere link here. The item rides in the address's hash, which the
 * routes ignore, so the inbox is still the inbox.
 */
export const inboxItemPath = (item: string): string => `inbox#${encodeURIComponent(item)}`;

/** The item an address's hash names, if it names one. */
export function itemFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  try {
    const id = decodeURIComponent(raw);
    return id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

/** Where answers go while the company can't take them: "Answers reach people when the company wakes at 14:00." */
export function restingLine(company: Pick<CompanyView, 'pause' | 'phase'>): string | null {
  if (company.pause) return company.pause.until !== null ? `Answers reach people when the company wakes at ${hourMinute(company.pause.until)}.` : `Answers reach people when ${waitsForWords(company.pause)}.`;
  if (company.phase === 'stopped') return 'Answers reach people when you resume the company.';
  return null;
}

/**
 * The link to the conversation with whom an item is about: "Message Mina", "Message the CEO", and for the office's
 * "start?", the task's owner. Null when there is nobody to message.
 */
export function messageLabel(company: CompanyView, item: Item): string | null {
  const id = itemPerson(company, item);
  return id === null ? null : `Message ${nameOf(company, id).called}`;
}
