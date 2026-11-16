// The messages' tests (test/steering-messages*.test.ts): the café's org and a 25-person company in the contract's
// shapes, the org a send sees, and a small office that makes, delivers, relays and acknowledges messages the way the
// company does, so a test reads as what happens in it.
import {
  ackFor,
  type AudienceOrg,
  escalateOf,
  type FollowUp,
  type MakeMessage,
  planSend,
  remindOf,
} from '../src/company/audience.ts';
import { type Message, OrgRefusal, type Person, STAKEHOLDER } from '../src/core/company.ts';
import type { Ack, Recipient } from '../src/core/steering.ts';
import type { Level } from '../src/core/studio.ts';
import { withAck, withDelivery } from '../src/core/trace-state.ts';

/** When every test's office starts: 14:00 on 5 Nov 2026, local time. */
export const AT = new Date(2026, 10, 5, 14, 0, 0).getTime();
export const min = (n: number): number => n * 60_000;

const person = (id: string, name: string, title: string, level: Level, room: string, reportsTo: string | null): Person => ({ id, name, title, level, room, reportsTo, look: {} });

/** The café of test/company-kit.ts: Noor the CEO and Tia in direction, Ada's design room, Ben's engineering with Ola's team. */
export function cafe(): Person[] {
  return [
    person('ceo', 'Noor', 'CEO', 'ceo', 'direction', null),
    person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
    person('ui-designer', 'Kai', 'UI designer', 'worker', 'design', 'head-of-design'),
    person('ux-designer', 'Lea', 'UX designer', 'worker', 'design', 'head-of-design'),
    person('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo'),
    person('frontend-lead', 'Ola', 'Frontend lead', 'lead', 'engineering', 'head-of-engineering'),
    person('frontend-engineer', 'Sam', 'Frontend engineer', 'worker', 'engineering', 'frontend-lead'),
    person('office-manager', 'Tia', 'Office manager', 'worker', 'direction', 'ceo'),
  ];
}

/** 25 people in six rooms: the CEO, six heads, two team leads under engineering, and their people. */
export function bigCompany(): Person[] {
  const w = (id: string, name: string, title: string, room: string, reportsTo: string) => person(id, name, title, 'worker', room, reportsTo);
  return [
    person('ceo', 'Noor', 'CEO', 'ceo', 'direction', null),
    w('office-manager', 'Tia', 'Office manager', 'direction', 'ceo'),
    person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
    w('ui-designer', 'Kai', 'UI designer', 'design', 'head-of-design'),
    w('ux-designer', 'Lea', 'UX designer', 'design', 'head-of-design'),
    w('brand-designer', 'Ivo', 'Brand designer', 'design', 'head-of-design'),
    w('motion-designer', 'Uma', 'Motion designer', 'design', 'head-of-design'),
    person('head-of-engineering', 'Ben', 'Head of engineering', 'head', 'engineering', 'ceo'),
    person('frontend-lead', 'Ola', 'Frontend lead', 'lead', 'engineering', 'head-of-engineering'),
    w('frontend-engineer', 'Sam', 'Frontend engineer', 'engineering', 'frontend-lead'),
    w('frontend-engineer-2', 'Eli', 'Frontend engineer', 'engineering', 'frontend-lead'),
    w('accessibility-specialist', 'Rui', 'Accessibility specialist', 'engineering', 'frontend-lead'),
    person('backend-lead', 'Max', 'Backend lead', 'lead', 'engineering', 'head-of-engineering'),
    w('backend-engineer', 'Zoe', 'Backend engineer', 'engineering', 'backend-lead'),
    w('payments-engineer', 'Ian', 'TWINT payments engineer', 'engineering', 'backend-lead'),
    w('devops-engineer', 'Ana', 'DevOps engineer', 'engineering', 'backend-lead'),
    person('head-of-content', 'Clara', 'Head of content', 'head', 'content', 'ceo'),
    w('german-copywriter', 'Mila', 'German copywriter', 'content', 'head-of-content'),
    w('local-seo-specialist', 'Joe', 'Local SEO specialist', 'content', 'head-of-content'),
    w('ux-writer', 'Oli', 'UX writer', 'content', 'head-of-content'),
    person('head-of-quality', 'Pia', 'Head of quality', 'head', 'quality', 'ceo'),
    w('qa-engineer', 'Joy', 'QA engineer', 'quality', 'head-of-quality'),
    w('security-reviewer', 'Ray', 'Security reviewer', 'quality', 'head-of-quality'),
    person('head-of-growth', 'Lou', 'Head of growth', 'head', 'growth', 'ceo'),
    w('analyst', 'Bo', 'Analyst', 'growth', 'head-of-growth'),
  ];
}

/** Rooms as studio.yaml names them: the departments, an office room nobody works in, and one with an acronym. */
const ROOMS: Readonly<Record<string, string>> = {
  direction: 'Direction',
  design: 'Design',
  engineering: 'Engineering',
  content: 'Content',
  quality: 'Quality',
  growth: 'Growth',
  games: 'Games room',
  data: 'Data & AI',
};

export function org(o: { people?: Person[]; wrote?: string[]; stakeholder?: string } = {}): AudienceOrg {
  const wrote = new Set(o.wrote ?? []);
  return {
    people: o.people ?? cafe(),
    stakeholder: o.stakeholder ?? 'Robin',
    roomName: (room) => (Object.hasOwn(ROOMS, room) ? (ROOMS[room] ?? null) : null),
    wroteTo: (p) => wrote.has(p),
  };
}

/** Makes messages as Company.newMessage does: the next id, the clock now, delivered at once when it is to the stakeholder. */
export function maker(now: () => number = () => AT): { make: MakeMessage; made: Message[] } {
  const made: Message[] = [];
  const make: MakeMessage = (from, to, text, extra) => {
    const at = now();
    const m: Message = {
      id: `m-${made.length + 1}`,
      from,
      to,
      text,
      origin: null,
      relayOf: null,
      at,
      deliveredAt: to === STAKEHOLDER ? at : null,
      interrupt: false,
      answers: null,
      note: null,
      ...(extra.for ? { for: extra.for } : {}),
      ...(extra.cites ? { cites: extra.cites } : {}),
      ...(extra.typed ? { typed: true } : {}),
    };
    made.push(m);
    return m;
  };
  return { make, made };
}

/** The refusal a call throws, so a test can check its code and sentence. */
export function refusal(run: () => unknown): OrgRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof OrgRefusal) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

/** An office's messages and acknowledgements as the company keeps them, with the clock a test moves on. */
export class Office {
  readonly org: AudienceOrg;
  messages: Message[] = [];
  acks: Ack[] = [];
  now = AT;
  private readonly numbered = maker(() => this.now);

  constructor(o: Parameters<typeof org>[0] = {}) {
    this.org = org(o);
  }

  get make(): MakeMessage {
    return this.numbered.make;
  }

  later(ms: number): this {
    this.now += ms;
    return this;
  }

  send(by: string, to: Recipient, text: string, forPeople?: string[]): Message[] {
    const copies = planSend(this.org, by, { to, text, for: forPeople }, this.make);
    this.messages.push(...copies);
    return copies;
  }

  /** Passes a message on as Company.relay does: the words, who first said them, and the message it passes on. */
  relay(by: string, original: Message, to: string[], note: string | null = null): Message[] {
    const copies = to.map((target) => ({ ...this.make(by, target, original.text, {}), origin: original.origin ?? original.from, relayOf: original.id, note }));
    this.messages.push(...copies);
    return copies;
  }

  /** The switchboard says the messages reached their people: how, as the desk tells it. */
  deliver(ids: readonly string[], how?: 'next-step' | 'new-turn'): this {
    for (const id of ids) this.messages = withDelivery(this.messages, id, this.now, how);
    return this;
  }

  ack(by: string, message: string, text: string, agree = true): Ack {
    const ack = ackFor(this.org, this.messages, by, { message, agree, text }, this.now);
    this.acks = withAck(this.acks, ack);
    return ack;
  }

  remind(message: string, person: string): FollowUp {
    return this.keep(remindOf(this.org, this.messages, this.acks, STAKEHOLDER, { message, person }, this.make));
  }

  escalate(message: string, person: string): FollowUp {
    return this.keep(escalateOf(this.org, this.messages, this.acks, STAKEHOLDER, { message, person }, this.make));
  }

  private keep(f: FollowUp): FollowUp {
    if (f.fresh) this.messages.push(f.message);
    return f;
  }
}
