// The leash, and model and effort per person (SPEC-v3.md "Steering" 6): the badge's words, where a leash comes from, the
// controls' choices, the change a save sends and the one that undoes it, and what to say after. Pure, so it can be
// tested; LeashBadge and the controls only draw it.
import type { CompanyView, PersonView } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { type Effort, EFFORTS, type Leash, LEASHES, type PersonSteering, type SettingsChange } from '../../../../src/core/steering.ts';
import { ROLE_MODELS } from '../../../../src/core/studio.ts';
import { capital } from '../../../../src/core/words.ts';
import { roomTitle } from '../compose/recipients.ts';
import { called } from '../people/peopleModel.ts';
import { modelName } from '../person/personModel.ts';
import { listOf } from '../trace/traceModel.ts';

type Studio = Pick<Snapshot, 'studio'>;
type Steered = Pick<CompanyView, 'steering'>;

export const LEASH_WORDS: Record<Leash, string> = { check: 'Checks with you', default: 'Default', trusted: 'Trusted' };

/** What each leash lets someone do, in a sentence. */
export const LEASH_MEANS: Record<Leash, string> = {
  check: 'Each new task waits in your inbox until you say start.',
  default: "The company's approvals: routine work goes ahead, and the ask list asks you.",
  trusted:
    "Routine work in the project without asking, other programs, deletes and git housekeeping included, and merging their own task's branch. Setup files and the ask list still ask you.",
};

/** Claude Code's effort levels, as the controls name them. */
export const EFFORT_WORDS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
export const DEFAULT_EFFORT = "Claude Code's default";

const isLeash = (v: unknown): v is Leash => LEASHES.some((l) => l === v);
const isEffort = (v: unknown): v is Effort => EFFORTS.some((e) => e === v);
const own = <T>(rec: Record<string, T> | undefined, key: string): T | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);

/** Their leash as the view works it out, or the company's default when the view says nothing. */
export function steeringOf(company: Steered, person: string): PersonSteering {
  return own(company.steering?.people, person) ?? { leash: own(company.steering?.settings.leash.people, person) ?? 'default', leashFrom: 'company', effort: null };
}

/** The badge beside a name: "Checks with you" or "Trusted"; nothing for Default. */
export function leashBadge(ps: Pick<PersonSteering, 'leash'> | null | undefined): { text: string; detail: string } | null {
  if (!ps || ps.leash === 'default') return null;
  return { text: LEASH_WORDS[ps.leash], detail: LEASH_MEANS[ps.leash] };
}

/** Where a leash comes from: "Their own setting.", "From the design room.", "The company's default." */
export function leashSource(snapshot: Studio, person: Pick<PersonView, 'room'>, ps: Pick<PersonSteering, 'leashFrom'>): string {
  switch (ps.leashFrom) {
    case 'person':
      return 'Their own setting.';
    case 'room':
      return `From ${roomTitle(snapshot, person.room)}.`;
    case 'company':
      return "The company's default.";
  }
}

/** A room's own leash; none means the company's default. */
export const roomLeash = (company: Steered, room: string): Leash | null => own(company.steering?.settings.leash.rooms, room) ?? null;

// ---------------------------------------------------------------------------------------------------------------
// A person's controls

/** What the controls hold: `room` for no leash of their own, `default` for Claude Code's own effort. */
export interface PersonDraft {
  leash: Leash | 'room';
  model: string;
  effort: Effort | 'default';
}

export function personDraft(company: Steered, person: Pick<PersonView, 'id' | 'model'>): PersonDraft {
  const leash = own(company.steering?.settings.leash.people, person.id);
  const effort = own(company.steering?.settings.effort, person.id) ?? steeringOf(company, person.id).effort;
  return { leash: isLeash(leash) ? leash : 'room', model: person.model, effort: isEffort(effort) ? effort : 'default' };
}

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** Their own leash, or the room's: "Same as their room (Trusted)", "Same as the company". */
export function leashChoices(company: Steered, person: Pick<PersonView, 'room'>): Choice<PersonDraft['leash']>[] {
  const room = roomLeash(company, person.room);
  return [
    { value: 'room', label: room ? `Same as their room (${LEASH_WORDS[room]})` : 'Same as the company' },
    ...LEASHES.map((l) => ({ value: l, label: LEASH_WORDS[l] })),
  ];
}

/** The models a role can run on, with the one they have first when it is a full model id. */
export function modelChoices(current: string): Choice<string>[] {
  const known = (ROLE_MODELS as readonly string[]).includes(current);
  const ids = known ? ROLE_MODELS.filter((m) => m !== 'inherit' || current === 'inherit') : [current, ...ROLE_MODELS.filter((m) => m !== 'inherit')];
  return ids.map((m) => ({ value: m, label: modelName(m) }));
}

export const effortChoices = (): Choice<PersonDraft['effort']>[] => [{ value: 'default', label: DEFAULT_EFFORT }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_WORDS[e] }))];

/** The one change that takes `before` to `after`, or null when nothing changed. */
export function changeOf(person: string, before: PersonDraft, after: PersonDraft): SettingsChange | null {
  const change: SettingsChange = {};
  if (after.leash !== before.leash) change.leash = { person, leash: after.leash === 'room' ? null : after.leash };
  if (after.model !== before.model) change.model = { person, model: after.model };
  if (after.effort !== before.effort) change.effort = { person, effort: after.effort === 'default' ? null : after.effort };
  return change.leash || change.model || change.effort ? change : null;
}

/** The leash they would have with this draft. */
export function leashWith(company: Steered, person: Pick<PersonView, 'room'>, draft: PersonDraft): Leash {
  return draft.leash === 'room' ? (roomLeash(company, person.room) ?? 'default') : draft.leash;
}

/** "Kai checks with you before each new task now. Model and effort apply from Kai's next desk." */
export function savedLine(company: Steered, person: Pick<PersonView, 'name' | 'title' | 'level' | 'room'>, before: PersonDraft, after: PersonDraft): string {
  const name = capital(called(person));
  const parts: string[] = [];
  if (after.leash !== before.leash) {
    const leash = leashWith(company, person, after);
    parts.push(
      leash === 'check'
        ? `${name} checks with you before each new task now.`
        : leash === 'trusted'
          ? `${name} is trusted with routine work in the project now.`
          : `${name} works by the company's approvals now.`,
    );
  }
  const what: string[] = [];
  if (after.model !== before.model) what.push(modelName(after.model));
  if (after.effort !== before.effort) what.push(after.effort === 'default' ? `${DEFAULT_EFFORT} effort` : `${EFFORT_WORDS[after.effort].toLowerCase()} effort`);
  if (what.length > 0) parts.push(capital(`${listOf(what)} from ${called(person)}'s next desk.`));
  return parts.join(' ');
}

/** When model and effort take hold. */
export const appliesLine = (person: Pick<PersonView, 'name' | 'title' | 'level'>): string => `Model and effort apply from ${called(person)}'s next desk.`;

// ---------------------------------------------------------------------------------------------------------------
// A room's leash

export const roomChoices = (): Choice<Leash>[] => LEASHES.map((l) => ({ value: l, label: LEASH_WORDS[l] }));

/** A room's leash change: Default clears the room's own, so its people follow the company. */
export const roomChange = (room: string, leash: Leash): SettingsChange => ({ leash: { room, leash: leash === 'default' ? null : leash } });

/** The people in a room who keep a leash of their own, so the room's doesn't reach them. */
export function ownLeashes(company: Pick<CompanyView, 'people' | 'steering'>, room: string): { id: string; name: string; leash: Leash }[] {
  return company.people
    .filter((p) => p.room === room)
    .flatMap((p) => {
      const leash = own(company.steering?.settings.leash.people, p.id);
      return isLeash(leash) ? [{ id: p.id, name: capital(called(p)), leash }] : [];
    });
}

/** "Mina keeps her own: checks with you." for the room's controls. */
export function ownLeashesLine(list: readonly { name: string; leash: Leash }[]): string | null {
  if (list.length === 0) return null;
  const each = list.map((x) => `${x.name} (${LEASH_WORDS[x.leash].toLowerCase()})`);
  return `${listOf(each, 4)} ${list.length === 1 ? 'keeps a leash of their own' : 'keep leashes of their own'}.`;
}

/** "The design room is trusted now." */
export function roomSavedLine(snapshot: Studio, room: string, leash: Leash): string {
  const title = capital(roomTitle(snapshot, room));
  return leash === 'check' ? `${title} checks with you before each new task now.` : leash === 'trusted' ? `${title} is trusted now.` : `${title} works by the company's approvals now.`;
}
