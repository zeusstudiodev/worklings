// How the office names people in its copy: one way, so the headline, the Now board, the catch-up account, Ask aside and
// the scene's bubbles all say the same thing. Pure, so the browser and the server agree.
import type { AgentState } from './office.ts';
import { inSentence } from './studio.ts';

export type Person = Pick<AgentState, 'kind' | 'name' | 'agentType' | 'sessionId'>;

/** Sessions as Team tells them apart: the first six characters of the id. */
export const sessionTag = (sessionId: string): string => sessionId.slice(0, 6);

/** More than one lead: then each is named with its session. */
export const severalLeads = (agents: readonly Pick<AgentState, 'kind'>[]): boolean => agents.filter((a) => a.kind === 'lead').length > 1;

/** A name from outside (a studio title, an agent type): one line, no control characters, at most 60 characters. */
const plainName = (text: string) => text.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * A person inside a sentence. The lead is "the lead", or "the lead in session 3f2a1c" when there are several; a role is
 * "the QA engineer" (a title keeps a leading acronym, see inSentence); a contractor goes by the type Claude Code gives it,
 * "the Explore agent", "the general-purpose agent", or "a subagent" when it has none.
 */
export function nameInSentence(person: Person, several = false): string {
  if (person.kind === 'lead') return several ? `the lead in session ${sessionTag(person.sessionId)}` : 'the lead';
  if (person.kind === 'role') return `the ${inSentence(plainName(person.name) || 'role')}`;
  const type = plainName(person.agentType.replace(/^.*:/, ''));
  return type && type !== 'agent' ? `the ${type} agent` : 'a subagent';
}

/** A person as Team lists them: "Lead" ("Lead, session 3f2a1c" when there are several), or their title or name. */
export function nameOnTeam(person: Person, several = false): string {
  if (person.kind === 'lead') return several ? `Lead, session ${sessionTag(person.sessionId)}` : 'Lead';
  return plainName(person.name) || 'Someone';
}

/** The first letter as a capital, for a name that starts a sentence: "The QA engineer needs your OK." */
export const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
