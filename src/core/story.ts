// The story: what happened in the studio, told as milestones in outcome words (docs/design.md, "The story"). Who asked
// for what, who was briefed, what got reported or done, what needed you, what was refused or stopped. Tool calls, file
// reads and the failures an agent works around are the log's steps, and never show here. Pure, so the browser and the
// tests agree.
import { clip, LINE_CHARS, plainText, RESULT_CHARS } from './now.ts';
import { type ActivityEntry, type AgentState, type Milestone, type MilestoneEntry, milestones } from './office.ts';
import { redactSecrets } from './redact.ts';
import { inSentence, type Studio, titleFromId } from './studio.ts';
import { capital, nameInSentence, severalLeads } from './words.ts';

/** Someone a line names, as the sentence says them, and the person it opens (null: you, or someone the office let go of). */
export interface StoryPerson {
  name: string;
  key: string | null;
}

export interface StoryLine {
  id: number;
  at: number;
  type: Milestone['type'];
  /** Who the line is about first, as it starts: "You", "The lead", "The UX designer". */
  who: StoryPerson;
  /** What they did: "asked", "briefed", "reported back", "asked for your OK to run npm install". */
  did: string;
  /** Whom it names after that: the person briefed, or (with several sessions) the lead you asked. */
  whom: StoryPerson | null;
  /** What it was about, as written: the request, the brief, the report, the question, the error, the task. */
  about: string | null;
  /** The line as one sentence: "The lead briefed the UX designer: Design the streak card". */
  text: string;
  /** Everyone it is about, for a badge's Recent work. */
  keys: string[];
}

/** What the story reads from a snapshot. */
export interface StorySource {
  agents: readonly AgentState[];
  activity: readonly ActivityEntry[];
  studio: Pick<Studio, 'gates' | 'roles'> | null;
}

/** A notice this close to a permission request from the same person is the request's own, which tells it already. */
export const ECHO_MS = 5_000;

const YOU: StoryPerson = { name: 'You', key: null };

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Free text as the story shows it: Markdown's marks gone, masked again (a mark can hide a secret's shape), cut. */
const shown = (text: string, max: number) => clip(redactSecrets(plainText(text)), max);

/** What someone said: agents sometimes start in lower case. */
const said = (text: string) => capital(shown(text, RESULT_CHARS));

/** The end of a message as a question is compared with it: no marks, quotes or brackets after the question mark. */
const ending = (text: string) => flat(plainText(text)).replace(/[*_`'")\]\s]+$/, '');

/**
 * A report or a last word, with the question it closes with. A long one was kept only to its start (see shownText), so
 * the question follows that start.
 */
function report(message: string | null, question: string | null): string | null {
  if (!message) return question ? said(question) : null;
  if (!question || ending(message).endsWith(ending(question))) return said(message);
  const ask = shown(question, LINE_CHARS);
  return capital(`${shown(message, RESULT_CHARS - ask.length - 1)} ${ask}`);
}

interface Context {
  agents: Map<string, AgentState>;
  several: boolean;
  studio: StorySource['studio'];
}

/**
 * Someone in a line, as the office names them. Someone the office has let go of (a session folded into the payroll) is
 * named from the log, and isn't a button.
 */
function person(key: string, who: string, ctx: Context): StoryPerson {
  const agent = ctx.agents.get(key);
  if (agent) return { name: nameInSentence(agent, ctx.several), key };
  const lead = key.endsWith(':lead');
  const kind = lead ? 'lead' : ctx.studio?.roles.some((r) => r.title === who) ? 'role' : 'contractor';
  return { name: nameInSentence({ kind, name: who, agentType: who, sessionId: lead ? key.slice(0, -':lead'.length) : '' }, ctx.several), key: null };
}

const gateName = (id: string, ctx: Context) => inSentence(shown(ctx.studio?.gates.find((g) => g.id === id)?.title ?? titleFromId(id), 60));

function lineOf(e: MilestoneEntry, ctx: Context): StoryLine {
  const m = e.milestone;
  const actor = person(e.agentKey, e.who, ctx);
  const line = (who: StoryPerson, did: string, whom: StoryPerson | null, about: string | null): StoryLine => {
    const first = { ...who, name: capital(who.name) };
    const head = `${first.name} ${did}${whom ? ` ${whom.name}` : ''}`;
    const keys = [e.agentKey, who.key, whom?.key].filter((k): k is string => typeof k === 'string');
    return { id: e.id, at: e.at, type: m.type, who: first, did, whom, about, text: about ? `${head}: ${about}` : head, keys: [...new Set(keys)] };
  };
  switch (m.type) {
    case 'asked':
      // With several sessions, which lead you asked; the line is in that lead's Recent work either way.
      return line(YOU, m.request ? 'asked' : ctx.several ? 'replied to' : 'replied', ctx.several ? actor : null, shown(m.text, LINE_CHARS));
    case 'briefed':
      return line(person(m.by, m.by.endsWith(':lead') ? 'Lead' : '', ctx), 'briefed', actor, m.task ? shown(m.task, LINE_CHARS) : null);
    case 'reported':
      return line(actor, m.question ? 'reported back with a question' : 'reported back', null, report(m.message, m.question));
    case 'finished': {
      const lead = e.agentKey.endsWith(':lead');
      return line(actor, m.question ? `finished with a question${lead ? ' for you' : ''}` : 'finished', null, report(m.message, m.question));
    }
    case 'needs-ok':
      return line(actor, `asked for your OK to ${shown(m.what, LINE_CHARS / 2)}`, null, null);
    case 'question':
      return m.question ? line(actor, 'asked you', null, shown(m.question, LINE_CHARS)) : line(actor, 'asked you a question in Claude Code', null, null);
    case 'needs-you':
      return line(actor, 'needed you in Claude Code', null, shown(m.message, LINE_CHARS));
    case 'refused':
      return line(actor, `wasn't allowed to ${shown(m.what, LINE_CHARS / 2)}`, null, null);
    case 'stopped':
      return line(actor, 'stopped on an error', null, shown(m.error, LINE_CHARS));
    case 'gate':
      return line(actor, `ran the ${gateName(m.gateId, ctx)}`, null, null);
    case 'task':
      return line(actor, m.done ? 'finished a task' : 'added a task', null, shown(m.title, LINE_CHARS));
  }
}

/**
 * The story so far, newest first: one line for each milestone in the log. With `people` (agent keys), only the lines
 * about them, for a badge's Recent work.
 */
export function storyLines(source: StorySource, people?: ReadonlySet<string>): StoryLine[] {
  const ctx: Context = { agents: new Map(source.agents.map((a) => [a.key, a])), several: severalLeads(source.agents), studio: source.studio };
  const entries = milestones(source.activity);
  // The reducer drops a notice that repeats a permission request already open (office.ts, `notice`); this catches
  // the other order, a notice that arrives just before its request.
  const asks = entries.filter((e) => e.milestone.type === 'needs-ok');
  const echo = (e: MilestoneEntry) => e.milestone.type === 'needs-you' && asks.some((a) => a.agentKey === e.agentKey && Math.abs(a.at - e.at) <= ECHO_MS);
  return entries
    .filter((e) => !echo(e))
    .map((e) => lineOf(e, ctx))
    .filter((l) => !people || l.keys.some((k) => people.has(k)))
    .sort((a, b) => b.at - a.at || b.id - a.id);
}
