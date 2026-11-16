// Steering's shapes for the trace, the decision log, the leash and the palette's tests (test/steering-trace*.test.ts,
// test/panels-steering-*.test.ts): factories in the contract's shapes (src/core/steering.ts) next to the panels' kit.
import type { CompanyView, Message } from '../src/core/company.ts';
import { STAKEHOLDER } from '../src/core/company.ts';
import type { Ack, Audience, Decision, PersonSteering, PlanVersion, SteeringView } from '../src/core/steering.ts';
import { company, message, min, NOW } from './panels-work-kit.ts';

export function steering(extra: Partial<SteeringView> = {}): SteeringView {
  return {
    plan: null,
    acks: [],
    decisions: [],
    settings: { planApproval: 'before-work', leash: { people: {}, rooms: {} }, effort: {} },
    people: {},
    ...extra,
  };
}

/** The café company with steering in its view. */
export function steered(extra: Partial<CompanyView> = {}, view: Partial<SteeringView> = {}): CompanyView {
  return company({ ...extra, steering: steering(view) });
}

export function ack(id: string, messageId: string, by: string, text: string, extra: Partial<Ack> = {}): Ack {
  return { id, message: messageId, by, agree: true, text, at: NOW - min(5), ...extra };
}

export function decision(id: string, by: string, kind: Decision['kind'], what: string, extra: Partial<Decision> = {}): Decision {
  return {
    id,
    at: NOW - min(30),
    by,
    kind,
    what,
    why: null,
    alternatives: [],
    people: [by],
    rooms: [],
    links: {},
    reversible: false,
    undone: null,
    reconsider: null,
    ...extra,
  };
}

export function planVersion(version: number, by: string, extra: Partial<PlanVersion> = {}): PlanVersion {
  return { version, by, at: NOW - min(40), plan: { goal: 'Pickup orders work', milestones: [], tasks: [] }, note: null, cites: [], ...extra };
}

export function audience(kind: Audience['kind'], id: string | null, title: string, group: string): Audience {
  return { kind, id, title, group };
}

/** The stakeholder's copy of a message for one person of a room, a team or everyone. */
export function copy(id: string, to: string, text: string, aud: Audience, extra: Partial<Message> = {}): Message {
  return message(id, STAKEHOLDER, to, text, { audience: aud, ...extra });
}

export function personSteering(leash: PersonSteering['leash'], leashFrom: PersonSteering['leashFrom'], effort: PersonSteering['effort'] = null): PersonSteering {
  return { leash, leashFrom, effort };
}
