// HUD helpers: how states read, how people are grouped by room, which agents belong to a role.
import type { OfficeSpend } from '../../../src/core/aside.ts';
import type { BaseDepartment } from '../../../src/core/departments.ts';
import type { PersonStateKind } from '../../../src/core/now.ts';
import { type AgentState, isActive } from '../../../src/core/office.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { DEPARTMENT_HUE } from '../scene/palette.ts';

/** A person's state, or "off" for a role nobody has called yet. */
export type StateWord = PersonStateKind | 'off';

/** The state in a word or two, as Team rows, room rows and the badge's pill say it (docs/design.md). */
export const STATE_TEXT: Record<StateWord, string> = {
  'on-it': 'On it',
  'needs-ok': 'Needs your OK',
  'needs-answer': 'Needs your answer',
  stuck: 'Stuck',
  'has-question': 'Has a question',
  done: 'Done',
  idle: 'Idle',
  off: 'Off duty',
};

/** The colour a state is set in (the `status--*` classes): green on it, dark yellow when it waits on you, red when stuck. */
export const STATE_TONE: Record<StateWord, 'working' | 'waiting' | 'error' | 'done' | 'idle' | 'off'> = {
  'on-it': 'working',
  'needs-ok': 'waiting',
  'needs-answer': 'waiting',
  'has-question': 'waiting',
  stuck: 'error',
  done: 'done',
  idle: 'idle',
  off: 'off',
};

export { isActive };

export function roomHue(snapshot: Snapshot, departmentId: string | null | undefined): string {
  const style = snapshot.studio?.departments.find((d) => d.id === departmentId)?.style;
  return style ? DEPARTMENT_HUE[style as BaseDepartment] : '#8C948F';
}

/** A person's wayfinding colour: the lead's gold, their room's hue, or a contractor's grey. */
export function personHue(snapshot: Snapshot, person: { kind: AgentState['kind']; roleId: string | null }): string {
  if (person.kind === 'lead') return '#C9B458';
  return roomHue(snapshot, snapshot.studio?.roles.find((r) => r.id === person.roleId)?.department);
}

export function agentsOfRole(snapshot: Snapshot, roleId: string): AgentState[] {
  return snapshot.agents.filter((a) => a.roleId === roleId).sort((a, b) => b.lastEventAt - a.lastEventAt);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the office's own payroll line counts: "3 questions and 1 catch-up", or in the demo "2 samples, free". Calls that
 * timed out or were cancelled count at their estimate, and the line says so: "…, 1 at its estimate".
 */
export function officeCalls(spend: OfficeSpend): string {
  const parts = [spend.questions > 0 ? count(spend.questions, 'question', 'questions') : '', spend.catchUps > 0 ? count(spend.catchUps, 'catch-up', 'catch-ups') : ''];
  if (spend.samples > 0) parts.push(`${count(spend.samples, 'sample', 'samples')}, free`);
  const calls = parts.filter(Boolean).join(' and ');
  if (spend.estimated <= 0) return calls;
  return `${calls}, ${spend.estimated} at ${spend.estimated === 1 ? 'its' : 'their'} estimate`;
}
