import { describe, expect, it } from 'vitest';
import { citesOf } from '../src/company/audience.ts';
import { type CompanyView, type Message, type Report, STAKEHOLDER, type StatusLine } from '../src/core/company.ts';
import { ACK_WINDOW_MS } from '../src/core/steering.ts';
import { familyOf, traceOf } from '../src/core/trace.ts';
import { acksInView } from '../src/core/trace-state.ts';
import { escalateTarget } from '../web/src/company/trace/traceModel.ts';
import { steering } from './panels-steering-kit.ts';
import { company, person as personView, task } from './panels-work-kit.ts';
import { AT, min, Office, refusal } from './steering-messages-kit.ts';

const WORDS = 'Make the palette darker.';

/** What the office's view carries of an office's people, messages and acknowledgements. */
function viewOf(office: Office, extra: Partial<CompanyView> = {}): CompanyView {
  return company({
    people: office.org.people.map((p) => personView(p.id, p.name, p.title, p.room, { level: p.level, reportsTo: p.reportsTo })),
    messages: office.messages,
    steering: steering({ acks: acksInView(office.acks, office.messages) }),
    ...extra,
  });
}

/**
 * The palette for Kai through the CEO (m-1), passed on to Ada (m-2), who keeps it; and the slot picker to the
 * engineering room (m-3 to m-5), where Sam's copy still waits for his desk.
 */
function stalled(): { office: Office; root: Message } {
  const office = new Office();
  const [root] = office.send(STAKEHOLDER, { kind: 'person', id: 'ceo' }, WORDS, ['ui-designer']);
  if (!root) throw new Error('No message.');
  office.later(min(1)).deliver([root.id], 'new-turn');
  office.later(min(1)).relay('ceo', root, ['head-of-design']);
  office.later(min(1)).deliver(['m-2'], 'next-step');
  office.send(STAKEHOLDER, { kind: 'room', id: 'engineering' }, 'Bigger slot picker.');
  office.deliver(['m-3', 'm-4'], 'next-step');
  office.later(ACK_WINDOW_MS);
  return { office, root };
}

describe('the trace, from what the company keeps', () => {
  it("lists every copy of a room's message with when and how it arrived, and each acknowledgement, from any of its ids", () => {
    const office = new Office();
    office.send(STAKEHOLDER, { kind: 'room', id: 'design' }, WORDS);
    office.later(min(1)).deliver(['m-1'], 'next-step').deliver(['m-2'], 'new-turn');
    const ack = office.later(min(1)).ack('ui-designer', 'm-2', 'Trying espresso brown.');
    for (const id of ['m-1', 'm-2', 'm-3']) {
      expect(traceOf(viewOf(office), id, office.now).stops).toEqual([
        { person: 'head-of-design', message: 'm-1', via: null, deliveredAt: AT + min(1), how: 'next-step', ack: null },
        { person: 'ui-designer', message: 'm-2', via: null, deliveredAt: AT + min(1), how: 'new-turn', ack },
        { person: 'ux-designer', message: 'm-3', via: null, deliveredAt: null, how: null, ack: null },
      ]);
    }
  });

  it('works out every flag: not delivered, not acknowledged, not passed on, and not reached', () => {
    const { office, root } = stalled();
    const flags = (id: string) => traceOf(viewOf(office), id, office.now).flags.map((f) => [f.kind, f.person, f.holder, f.since]);
    expect(flags(root.id)).toEqual([
      ['not-reached', 'ui-designer', 'head-of-design', AT],
      ['no-ack', 'ceo', 'ceo', AT + min(1)],
      ['not-passed-on', 'head-of-design', 'head-of-design', AT + min(3)],
    ]);
    // Ola is a manager too, but got it with her room, so only her acknowledgement is missing.
    expect(flags('m-3')).toEqual([
      ['not-delivered', 'frontend-engineer', 'frontend-engineer', AT + min(3)],
      ['no-ack', 'frontend-lead', 'frontend-lead', AT + min(3)],
      ['no-ack', 'head-of-engineering', 'head-of-engineering', AT + min(3)],
    ]);
  });

  it('clears the flags once everyone has it and has acknowledged it', () => {
    const { office, root } = stalled();
    const [toKai] = office.relay('head-of-design', office.messages[1] as Message, ['ui-designer']);
    office.deliver([toKai?.id ?? ''], 'new-turn');
    office.ack('ceo', root.id, 'Passed it to Ada.');
    office.ack('head-of-design', 'm-2', 'Kai takes it.');
    office.ack('ui-designer', toKai?.id ?? '', 'Darker by tonight.');
    expect(traceOf(viewOf(office), root.id, office.now + ACK_WINDOW_MS).flags).toEqual([]);
  });

  it('reminds the holder each flag names, and escalates to whom the trace offers', () => {
    const { office, root } = stalled();
    const trace = traceOf(viewOf(office), root.id, office.now);
    expect(trace.flags.length).toBeGreaterThan(0);
    for (const flag of trace.flags) {
      expect(office.remind(root.id, flag.holder).message.to).toBe(flag.holder);
      const target = escalateTarget(viewOf(office), flag.holder);
      if (target === null) expect(refusal(() => office.escalate(root.id, flag.holder)).code).toBe('invalid');
      else expect(office.escalate(root.id, flag.holder).message.to).toBe(target);
    }
    // A copy still on its way: a reminder would wait with it, so Escalate is the way.
    const [waiting] = traceOf(viewOf(office), 'm-3', office.now).flags;
    expect(waiting?.kind).toBe('not-delivered');
    expect(refusal(() => office.remind('m-3', waiting?.holder ?? '')).code).toBe('conflict');
    expect(office.escalate('m-3', waiting?.holder ?? '').message.to).toBe(escalateTarget(viewOf(office), waiting?.holder ?? ''));
  });

  it('shows a follow-up as one, never as a stop, and counts an acknowledgement of it', () => {
    const office = new Office();
    office.send(STAKEHOLDER, { kind: 'room', id: 'design' }, WORDS);
    office.later(min(1)).deliver(['m-1', 'm-2', 'm-3']);
    const { message: reminder } = office.later(ACK_WINDOW_MS).remind('m-2', 'ux-designer');
    office.later(min(1)).deliver([reminder.id]);
    const ack = office.ack('ux-designer', reminder.id, 'Checking the checkout now.');
    const view = viewOf(office);
    expect(familyOf(view.messages, 'm-1').followUps.map((m) => m.id)).toEqual([reminder.id]);
    const trace = traceOf(view, 'm-1', office.now);
    expect(trace.stops.map((s) => s.person)).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    expect(trace.stops.find((s) => s.person === 'ux-designer')?.ack).toEqual(ack);
    expect(trace.flags.map((f) => f.person)).toEqual(['head-of-design', 'ui-designer']);
  });

  it('lists the tasks, status lines and reports that cite it, by the ids the company keeps', () => {
    const office = new Office();
    office.send(STAKEHOLDER, { kind: 'room', id: 'design' }, WORDS);
    const cites = citesOf(office.org, office.messages, 'ui-designer', ['m-2', ' m-2 ']);
    expect(cites).toEqual(['m-2']);
    const at = AT + min(5);
    const report: Report = { id: 'r-1', person: 'ui-designer', to: 'head-of-design', taskId: 't-1', outcome: 'done', text: 'The palette is darker. Buttons pass 4.5:1.', at: at + 2, cites };
    const status: StatusLine = { person: 'ui-designer', text: 'Darkening the palette.', taskId: 't-1', at: at + 1, cites };
    const work = task('t-1', 'ui-designer', 'Darker palette', { askedBy: 'head-of-design', createdAt: at, cites: ['m-1'] });
    const found = traceOf(viewOf(office, { tasks: [work], statuses: [status], reports: [report] }), 'm-3', at + 3).cites;
    expect(found.map((c) => [c.kind, c.id])).toEqual([
      ['task', 't-1'],
      ['status', `ui-designer@${at + 1}`],
      ['report', 'r-1'],
    ]);
  });
});
