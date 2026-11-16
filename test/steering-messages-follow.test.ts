import { describe, expect, it } from 'vitest';
import { escalateOf, remindOf } from '../src/company/audience.ts';
import { type Message, STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import { cafe, min, Office, refusal } from './steering-messages-kit.ts';

const WORDS = 'Make the palette darker.';
const ids = (messages: readonly Message[]) => messages.map((m) => m.id);

/** "Make the palette darker" to the CEO for Kai (m-1), passed on to Ada (m-2), both delivered; Kai has nothing yet. */
function forKai(): { office: Office; root: Message; toAda: Message } {
  const office = new Office();
  const [root] = office.send(STAKEHOLDER, { kind: 'person', id: 'ceo' }, WORDS, ['ui-designer']);
  if (!root) throw new Error('No message.');
  office.later(min(1)).deliver([root.id], 'new-turn');
  const [toAda] = office.later(min(2)).relay('ceo', root, ['head-of-design']);
  if (!toAda) throw new Error('No relay.');
  office.later(min(1)).deliver([toAda.id], 'next-step');
  return { office, root, toAda };
}

/** The stakeholder's message to the design room, delivered: Ada has m-1, Kai m-2 and Lea m-3. */
function designRoom(): Office {
  const office = new Office();
  const copies = office.send(STAKEHOLDER, { kind: 'room', id: 'design' }, WORDS);
  office.later(min(1)).deliver(ids(copies), 'next-step');
  return office;
}

describe('Remind', () => {
  it('sends the holder a message from the office that cites the message and asks them to pass it on to whoever it is for', () => {
    const { office, root, toAda } = forKai();
    const { message, fresh } = office.remind(root.id, 'head-of-design');
    expect(fresh).toBe(true);
    expect(message).toMatchObject({ id: 'm-3', from: THE_OFFICE, to: 'head-of-design', cites: [root.id, toAda.id], deliveredAt: null });
    expect(message.text).toBe(
      [
        `A reminder about message ${toAda.id}, which Noor passed on from Robin: “${WORDS}”`,
        `Robin means it for Kai, UI designer, who hasn't got it yet: pass it on with relay (message ${toAda.id}).`,
        `Acknowledge it with ack (message ${toAda.id}): one sentence on what you will do with it, or why you disagree.`,
      ].join('\n\n'),
    );
  });

  it('asks someone without a manager, the CEO here, only for what waits on them', () => {
    const { office, root } = forKai();
    // The CEO passed it on, so only the acknowledgement waits; Kai's copy waits with Ada.
    expect(office.remind(root.id, 'ceo').message.text).toBe(
      [`A reminder about message ${root.id}, from Robin: “${WORDS}”`, `Acknowledge it with ack (message ${root.id}): one sentence on what you will do with it, or why you disagree.`].join('\n\n'),
    );
  });

  it('asks a manager who got it on their own, and passed it on to nobody, to pass it on', () => {
    const office = new Office();
    const [m] = office.send(STAKEHOLDER, { kind: 'person', id: 'head-of-engineering' }, 'The slot picker needs bigger targets.');
    office.deliver(ids(m ? [m] : []), 'new-turn');
    expect(office.remind('m-1', 'head-of-engineering').message.text.split('\n\n')[1]).toBe(
      'Pass it on with relay (message m-1) to whoever it concerns below you, or say why not with ack.',
    );
  });

  it("asks where it stands once they've acknowledged it and nothing else waits on them", () => {
    const office = designRoom();
    office.ack('ui-designer', 'm-2', 'Trying espresso brown.');
    expect(office.remind('m-1', 'ui-designer').message.text).toBe(
      [
        `A reminder about message m-2, from Robin to the design room: “${WORDS}”`,
        'You acknowledged it: “Trying espresso brown.” Robin would like to know where it stands: post a status line, or report when it\'s done.',
      ].join('\n\n'),
    );
  });

  it("finds the holder's own copy from any id of the message: the one sent, a copy, a relay or the group", () => {
    const office = designRoom();
    for (const id of ['m-1', 'm-2', 'm-3']) expect(remindOf(office.org, office.messages, office.acks, STAKEHOLDER, { message: id, person: 'ui-designer' }, office.make).message.cites).toEqual(['m-1', 'm-2']);
    const { office: relayed, root, toAda } = forKai();
    expect(relayed.remind(toAda.id, 'head-of-design').message.cites).toEqual([root.id, toAda.id]);
  });

  it('sends it once while the first reminder still waits for its person, and again once that one has landed', () => {
    const office = designRoom();
    const first = office.remind('m-1', 'ux-designer');
    const again = office.remind('m-1', 'ux-designer');
    expect(again).toEqual({ message: first.message, fresh: false });
    expect(office.messages.filter((m) => m.from === THE_OFFICE)).toHaveLength(1);
    office.later(min(5)).deliver([first.message.id]);
    expect(office.remind('m-1', 'ux-designer').fresh).toBe(true);
  });

  it("is refused for someone it hasn't reached, naming who has it", () => {
    const { office, root } = forKai();
    expect(refusal(() => office.remind(root.id, 'ui-designer'))).toMatchObject({ code: 'conflict', message: "Kai hasn't had message m-1 yet; Ada has it, so remind them." });
    expect(refusal(() => office.remind(root.id, 'frontend-engineer'))).toMatchObject({ code: 'conflict', message: "Message m-1 didn't go to Sam, so there's nothing to remind them of." });
  });

  it('is refused while their copy still waits for them, since a reminder would wait with it', () => {
    const office = new Office();
    office.send(STAKEHOLDER, { kind: 'person', id: 'ux-designer' }, 'Check the checkout.');
    expect(refusal(() => office.remind('m-1', 'ux-designer'))).toMatchObject({
      code: 'conflict',
      message: "Lea hasn't got message m-1 yet, so a reminder would only wait with it; escalate it instead.",
    });
    expect(office.messages).toHaveLength(1);
  });

  it("is the stakeholder's alone, and only for the stakeholder's own messages", () => {
    const office = designRoom();
    expect(refusal(() => remindOf(office.org, office.messages, office.acks, 'ceo', { message: 'm-1', person: 'ui-designer' }, office.make))).toMatchObject({
      code: 'not-allowed',
      message: 'Only Robin can remind someone of a message.',
    });
    const [fromAda] = office.send('head-of-design', { kind: 'person', id: 'ui-designer' }, 'Darker, please.');
    office.deliver(ids(fromAda ? [fromAda] : []));
    expect(refusal(() => office.remind(fromAda?.id ?? '', 'ui-designer'))).toMatchObject({ code: 'not-allowed', message: 'Only your own messages have a trace to follow up.' });
    expect(refusal(() => office.remind('m-99', 'ui-designer'))).toMatchObject({ code: 'unknown', message: "There's no message of yours with that id." });
    expect(refusal(() => office.remind('', 'ui-designer')).code).toBe('unknown');
    expect(refusal(() => office.remind('m-1', 'seo-specialist')).code).toBe('unknown');
  });
});

describe('Escalate', () => {
  it("tells the holder's manager what is stuck with them, citing the message", () => {
    const { office, root, toAda } = forKai();
    const { message } = office.escalate(root.id, 'head-of-design');
    expect(message).toMatchObject({ from: THE_OFFICE, to: 'ceo', cites: [root.id, toAda.id] });
    expect(message.text).toBe(
      [
        `Robin escalated this to you: message ${toAda.id}, which you passed on from Robin, is waiting on Ada, head of design. Robin means it for Kai, UI designer, and Ada hasn't passed it on yet. Ada hasn't acknowledged it yet.`,
        `The message: “${WORDS}”`,
        'See that it gets where it should, and acknowledge this with ack: one sentence on what you will do.',
      ].join('\n\n'),
    );
  });

  it("tells the manager of someone it is for and hasn't reached, and that they have it to pass on", () => {
    const { office, root, toAda } = forKai();
    const { message } = office.escalate(root.id, 'ui-designer');
    expect(message.to).toBe('head-of-design');
    expect(message.cites).toEqual([root.id]);
    expect(message.text.split('\n\n')[0]).toBe(`Robin escalated this to you: message ${root.id} hasn't reached Kai, UI designer, and Robin means it for them. You have it as message ${toAda.id}: pass it on with relay.`);
  });

  it('names who has it when that is someone else', () => {
    const office = new Office();
    // Kai's manager is Ada, but the message went to Sam.
    const [toSam] = office.send(STAKEHOLDER, { kind: 'person', id: 'frontend-engineer' }, 'Tell Kai the slot picker needs his colours.', ['ui-designer']);
    office.deliver(ids(toSam ? [toSam] : []));
    expect(office.escalate('m-1', 'ui-designer').message.text.split('\n\n')[0]).toBe("Robin escalated this to you: message m-1 hasn't reached Kai, UI designer, and Robin means it for them. Sam has it.");
  });

  it('says what they said when they acknowledged it, agreeing or not', () => {
    const office = designRoom();
    office.ack('ui-designer', 'm-2', 'Espresso brown fails contrast on the buttons.', false);
    expect(office.escalate('m-1', 'ui-designer').message.text.split('\n\n')[0]).toBe(
      'Robin escalated this to you: message m-2, from Robin to the design room, is waiting on Kai, UI designer. Kai acknowledged it and disagrees: “Espresso brown fails contrast on the buttons.”',
    );
  });

  it("says when it hasn't reached them yet", () => {
    const office = new Office();
    office.send(STAKEHOLDER, { kind: 'person', id: 'ux-designer' }, 'Check the checkout.');
    expect(office.escalate('m-1', 'ux-designer').message.text.split('\n\n')[0]).toBe(
      "Robin escalated this to you: message m-1, from Robin, is waiting on Lea, UX designer. It hasn't reached Lea yet.",
    );
  });

  it('goes to the CEO for someone without a manager', () => {
    const people = cafe().map((p) => (p.id === 'office-manager' ? { ...p, reportsTo: null } : p));
    const office = new Office({ people });
    const [m] = office.send(STAKEHOLDER, { kind: 'person', id: 'office-manager' }, 'Book the photographer.');
    office.deliver(ids(m ? [m] : []), 'new-turn');
    const { message } = office.escalate('m-1', 'office-manager');
    expect(message.to).toBe('ceo');
    expect(message.text.split('\n\n')[0]).toBe('Robin escalated this to you: message m-1, from Robin, is waiting on Tia, office manager. Tia hasn\'t acknowledged it yet.');
  });

  it('is refused about the CEO, who answers only to the stakeholder, and when nobody is above them', () => {
    const { office, root } = forKai();
    expect(refusal(() => office.escalate(root.id, 'ceo'))).toMatchObject({ code: 'invalid', message: 'Noor, the CEO, answers only to you; remind them instead.' });
    const alone = new Office({ people: cafe().filter((p) => p.id === 'office-manager').map((p) => ({ ...p, reportsTo: null })) });
    alone.send(STAKEHOLDER, { kind: 'person', id: 'office-manager' }, 'Book the photographer.');
    expect(refusal(() => alone.escalate('m-1', 'office-manager'))).toMatchObject({ code: 'unknown', message: 'Nobody is above Tia in the org to tell; remind them instead.' });
  });

  it("is refused about someone it didn't go to and isn't meant for", () => {
    const { office, root } = forKai();
    expect(refusal(() => office.escalate(root.id, 'frontend-engineer'))).toMatchObject({
      code: 'conflict',
      message: "Message m-1 didn't go to Sam and isn't meant for them, so there's nothing to escalate about them.",
    });
  });

  it('sends it once while the first still waits for the manager', () => {
    const office = designRoom();
    const first = office.escalate('m-1', 'ux-designer');
    expect(office.escalate('m-1', 'ux-designer')).toEqual({ message: first.message, fresh: false });
    expect(office.messages.filter((m) => m.from === THE_OFFICE).map((m) => m.to)).toEqual(['head-of-design']);
  });

  it("is the stakeholder's alone", () => {
    const office = designRoom();
    expect(refusal(() => escalateOf(office.org, office.messages, office.acks, 'head-of-design', { message: 'm-1', person: 'ui-designer' }, office.make))).toMatchObject({
      code: 'not-allowed',
      message: 'Only Robin can escalate a message.',
    });
  });
});
