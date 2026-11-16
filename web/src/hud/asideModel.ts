// Ask aside as the conversation shows it: who a conversation is with, what its thread holds, and the office's words for
// every state and failure (docs/design.md, "Ask aside: a conversation in the scene" and "Failures"). Pure, so it can be
// tested; Catch me up shares the failure and running lines.
import { ASIDE_ANSWERS_KEPT, type AsideAnswer, type AsideCall, type AsideFailure, type AsideView, askEstimate, BUSY_MESSAGE, CALL_TIMEOUT_SECONDS, threadFor } from '../../../src/core/aside.ts';
import { coarseAge } from '../../../src/core/now.ts';
import type { AgentKind, AgentState } from '../../../src/core/office.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { capital, nameInSentence, severalLeads } from '../../../src/core/words.ts';
import { aboutCost, duration, hourMinute, spent } from '../lib/format.ts';

/** Who a conversation is opened for: a role, whose calls share one conversation, or one agent (a lead, a contractor). */
export interface TalkTarget {
  roleId: string | null;
  agentKey: string | null;
}

export interface Talk {
  target: TalkTarget;
  /** Where its draft and its failed attempt are kept: one conversation per role, lead session or contractor call. */
  threadKey: string;
  /** "QA engineer", "Lead", "Explore". */
  title: string;
  /** "the QA engineer", "the lead", "the Explore agent". */
  who: string;
  kind: AgentKind;
  roleId: string | null;
  /** The call questions go to; null for a role that hasn't worked in a session the office has seen. */
  agent: AgentState | null;
  /** The role's calls, newest first (just the one for a lead or a contractor). */
  calls: AgentState[];
}

/** How someone is talked to: a role across its calls, anyone else as themselves. */
export function targetOf(agent: Pick<AgentState, 'key' | 'kind' | 'roleId'>): TalkTarget {
  return agent.kind === 'role' && agent.roleId !== null ? { roleId: agent.roleId, agentKey: agent.key } : { roleId: null, agentKey: agent.key };
}

/** The conversation for a target as the snapshot has it; null when that person is no longer in the office. */
export function talkFor(snapshot: Pick<Snapshot, 'agents' | 'studio'>, target: TalkTarget): Talk | null {
  if (target.roleId !== null) {
    const roleId = target.roleId;
    const role = snapshot.studio?.roles.find((r) => r.id === roleId);
    const calls = snapshot.agents.filter((a) => a.roleId === roleId).sort((a, b) => b.startedAt - a.startedAt);
    const agent = (target.agentKey ? calls.find((a) => a.key === target.agentKey) : undefined) ?? calls[0] ?? null;
    if (!role && !agent) return null;
    const title = role?.title ?? agent?.name ?? roleId;
    return { target, threadKey: `role:${roleId}`, title, who: nameInSentence({ kind: 'role', name: title, agentType: roleId, sessionId: '' }), kind: 'role', roleId, agent, calls };
  }
  const agent = snapshot.agents.find((a) => a.key === target.agentKey);
  if (!agent) return null;
  const title = agent.kind === 'lead' ? 'Lead' : agent.name;
  return { target, threadKey: `agent:${agent.key}`, title, who: nameInSentence(agent, severalLeads(snapshot.agents)), kind: agent.kind, roleId: agent.roleId, agent, calls: [agent] };
}

/** The questions of a conversation, as threadFor sees them. */
const asked = (talk: Talk) => ({ key: talk.agent?.key ?? '', kind: talk.kind, roleId: talk.roleId });

export interface ThreadView {
  /** The last three exchanges, answered or failed, oldest first. */
  answers: AsideAnswer[];
  /** The question this conversation is waiting on. */
  running: AsideCall | null;
  /** A question to someone else, or a catch-up, that this conversation has to wait for. */
  elsewhere: AsideCall | null;
}

export function threadView(view: AsideView, talk: Talk): ThreadView {
  const mine = view.running !== null && view.running.kind === 'ask' && threadFor([view.running], asked(talk)).length > 0;
  return {
    answers: threadFor(view.answers, asked(talk)).slice(-3),
    running: mine ? view.running : null,
    elsewhere: mine ? null : view.running,
  };
}

export const ASK_FAILED = "Couldn't get an answer.";
export const LOCKED = 'Open the office from the link the CLI printed. It carries the access token.';
const UNREACHABLE = "The office didn't answer. Is it still running?";

/** The words for a failed question or catch-up, after "Couldn't get an answer." (or "Couldn't write your catch-up."). */
export function failureCopy(failure: AsideFailure, who: string): string {
  switch (failure.code) {
    case 'cancelled':
      return 'Cancelled.';
    case 'not-installed':
      return "Worklings asks through your own Claude Code and couldn't find it. Install Claude Code, or set WORKLINGS_CLAUDE to its path, then restart the office.";
    case 'not-signed-in':
      return "Claude Code isn't signed in. Run claude in a terminal, sign in, then try again.";
    case 'timed-out':
      return `Claude Code took more than ${CALL_TIMEOUT_SECONDS} seconds, so the office stopped it. Try again.`;
    case 'limit':
      // Without a reset time this may be an overload rather than your limit: the office's own sentence says which.
      return failure.detail ? `You've reached your Claude usage limit. It resets ${/^\d/.test(failure.detail) ? 'at ' : ''}${failure.detail}.` : failure.message;
    case 'too-long':
      return "The lead's conversation is too long for Haiku. Ask it with /btw in Claude Code instead.";
    case 'bad-output':
      return "Claude Code sent back something the office couldn't read. Try again, or update Claude Code if it keeps happening.";
    case 'failed':
      return failure.detail ? `Claude Code stopped with an error: ${failure.detail.replace(/[\s.]+$/, '')}. Try again.` : failure.message;
    case 'no-transcript':
      return `The office can't find ${who}'s transcript on this machine, so there's nothing to answer from.`;
    case 'busy':
      return BUSY_MESSAGE;
    case 'rate-limited':
      return failure.message;
  }
}

/** What the office says when it turns a question down before asking (the request's status, code and wait). */
export function refusalCopy(refusal: { status: number; code: string | null; message: string; retryAfter: number | null }): string {
  if (refusal.status === 0) return UNREACHABLE;
  // Over --lan the office asks Claude Code only for the computer it runs on: the server's sentence says so.
  if (refusal.code === 'local-only') return refusal.message;
  if (refusal.status === 401 || refusal.status === 403) return LOCKED;
  if (refusal.code === 'busy') return BUSY_MESSAGE;
  if (refusal.code === 'rate-limited') {
    const wait = refusal.retryAfter;
    return `The office takes a few calls a minute. Try again ${wait === null ? 'in a minute' : `in ${wait} second${wait === 1 ? '' : 's'}`}.`;
  }
  return refusal.message;
}

/**
 * "The QA engineer is answering, 6s so far." or "Haiku is writing your catch-up, 12s so far.", with the stop (60 s)
 * said from halfway. The demo calls nothing: there the office is making up a sample, which takes two seconds.
 */
export function runningLine(call: Pick<AsideCall, 'kind' | 'startedAt'>, who: string, realNow: number, demo = false): string {
  const seconds = Math.max(0, Math.floor((realNow - call.startedAt) / 1000));
  if (demo) return `The office is making up ${call.kind === 'ask' ? `${who}'s sample answer` : 'a sample catch-up'}, ${seconds}s so far.`;
  const doing = call.kind === 'ask' ? `${capital(who)} is answering` : 'Haiku is writing your catch-up';
  return `${doing}, ${seconds}s so far.${seconds >= CALL_TIMEOUT_SECONDS / 2 ? ` It stops at ${CALL_TIMEOUT_SECONDS}s.` : ''}`;
}

/**
 * The running line once Cancel is pressed, until the call is gone from the office: stopping Claude Code can take a
 * second or two (on Windows the office waits for taskkill), and the line should show the press was taken.
 */
export const CANCELLING = 'Cancelling…';

/** Who a running call is with, in a sentence, from the snapshot: the person it was put to. */
export function runningWho(call: AsideCall, snapshot: Pick<Snapshot, 'agents'>): string {
  const agent = snapshot.agents.find((a) => a.key === call.agentKey);
  return agent ? nameInSentence(agent, severalLeads(snapshot.agents)) : `the ${call.who ?? 'person'}`;
}

/** The lines under the title: what an answer costs, which call answers, and in a replay, from when. */
export function headerLines(snapshot: Pick<Snapshot, 'mode' | 'replay'>, talk: Talk): string[] {
  const lines: string[] = [];
  if (snapshot.mode === 'demo') lines.push("Answers in the demo are made-up samples, so they're free.");
  else if (talk.agent) {
    const estimate = askEstimate(talk.agent, snapshot.mode);
    lines.push(estimate ? `${aboutCost(estimate.cost)} on Haiku for each answer.` : 'The cost shows with the answer.');
  }
  if (talk.agent && talk.calls.length > 1) lines.push(`Questions go to its call from ${hourMinute(talk.agent.startedAt)}.`);
  if (snapshot.mode === 'replay' && snapshot.replay) lines.push(`From the session as it stood at ${duration(snapshot.replay.position - snapshot.replay.startedAt)}.`);
  return lines;
}

/** How an answer is signed: "2 min ago, 0.6¢ on Haiku", its replay position, or as a demo sample. */
export function signature(answer: AsideAnswer, realNow: number, replayStart: number | null): string {
  if (answer.source === 'sample') return 'Sample answer, made up for the demo.';
  const when = answer.asOf !== null && replayStart !== null ? `At ${duration(answer.asOf - replayStart)}` : capital(coarseAge(realNow - answer.answeredAt));
  return `${when}, ${spent(answer.cost)} on Haiku`;
}

/** Why the controls can't be used, if they can't: someone who never worked, a missing link, a dropped connection. */
export function blockedReason(talk: Talk, ctx: { locked: boolean; stoppedAt: number | null }): string | null {
  if (!talk.agent) return `You can ask ${talk.who} once it has worked in a session.`;
  if (ctx.locked) return LOCKED;
  if (ctx.stoppedAt !== null) return `Reconnecting to the office. This is how things stood at ${hourMinute(ctx.stoppedAt)}.`;
  return null;
}

/** What your bubble says when the office kept no copy of a question you didn't ask in this tab. */
export const YOUR_OWN_QUESTION = 'Your own question';

/**
 * A question as your bubble shows it. The demo keeps only suggested questions (its reads are open to anyone on the
 * machine), so a free-text one comes back without its words: this tab shows what it typed, by the call's id. `text` is
 * null when nobody here knows it, so it can't be asked again.
 */
export function shownQuestion(item: { id: string; question: string | null }, typedHere: Readonly<Record<string, string>>): { shown: string; text: string | null } {
  const text = item.question ?? (Object.hasOwn(typedHere, item.id) ? (typedHere[item.id] ?? null) : null);
  return { shown: text ?? YOUR_OWN_QUESTION, text };
}

/** What this tab typed, with one more question: the newest ones, as many as the office keeps answers for. */
export function withTyped(typed: Readonly<Record<string, string>>, id: string, question: string): Record<string, string> {
  return Object.fromEntries([...Object.entries(typed), [id, question]].slice(-ASIDE_ANSWERS_KEPT));
}

/** "120 of 500", or the over-limit sentence; counted as Unicode characters, as the office counts them. */
export function counter(text: string, max: number): { text: string; over: boolean } {
  const length = [...text.trim()].length;
  if (length <= max) return { text: `${length} of ${max}`, over: false };
  return { text: `${length} of ${max}. Shorten it by ${length - max} to ask.`, over: true };
}
