import { describe, expect, it } from 'vitest';
import { type Message, STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import type { OrgProposal } from '../src/core/org.ts';
import type { Recipient } from '../src/core/steering.ts';
import { crashCopy, ended, eventsFile, fenced, logText, proposal, rig } from './company-kit.ts';
import { bigCompany, refusal } from './steering-messages-kit.ts';

const WORDS = 'Make the palette darker.';
const design: Recipient = { kind: 'room', id: 'design' };
const to = (id: string): Recipient => ({ kind: 'person', id });

/** The 25 people of the messages' kit as a proposal the fake org writes, in six rooms. */
function bigProposal(): OrgProposal {
  const styles: Record<string, OrgProposal['rooms'][number]['style']> = { direction: 'direction', design: 'design', engineering: 'engineering', content: 'content', quality: 'quality', growth: 'data' };
  return proposal({
    rooms: Object.entries(styles).map(([id, style]) => ({ id, title: id.charAt(0).toUpperCase() + id.slice(1), style })),
    people: bigCompany().map((p) => ({ id: p.id, name: p.name, title: p.title, level: p.level, room: p.room, reportsTo: p.reportsTo, model: 'sonnet', owns: `The ${p.title.toLowerCase()}'s area.` })),
    questions: [],
  });
}

describe('a message to a room, a team or everyone, through the company', () => {
  it('reaches each person in the room as a turn of their own that names the room, kept before it is handed over', async () => {
    const { company, desks, root } = await rig({ running: true });
    const kept: boolean[] = [];
    desks().onTurn = (t) => kept.push(t.turn.messageId !== null && logText(root).includes(`"id":"${t.turn.messageId}"`));
    const copies = company.send(STAKEHOLDER, { to: design, text: `  ${WORDS}  `, for: [] });
    expect(copies.map((m) => m.to)).toEqual(['head-of-design', 'ui-designer', 'ux-designer']);
    expect(kept).toEqual([true, true, true]);
    const group = copies[0]?.id;
    for (const m of copies) {
      expect(m).toMatchObject({ from: STAKEHOLDER, text: WORDS, deliveredAt: null, audience: { kind: 'room', id: 'design', title: 'the design room', group } });
      const turn = desks().turns.find((t) => t.turn.messageId === m.id);
      expect(turn?.plan.person.id).toBe(m.to);
      expect(turn && fenced(turn)).toMatchObject({ who: 'From Robin, the stakeholder, to the design room', id: m.id, words: WORDS });
    }
    expect(company.view().messages.filter((m) => m.audience?.group === group).map((m) => m.id)).toEqual(copies.map((m) => m.id));
  });

  it('keeps how each copy was taken, as the switchboard says it: at the next step, or as a new turn', async () => {
    const { company, desks } = await rig({ running: true });
    const [ada, kai, lea] = company.send(STAKEHOLDER, { to: design, text: WORDS, for: [] });
    desks().events.delivered(ada?.id ?? '', 1_000, 'next-step');
    desks().events.delivered(kai?.id ?? '', 1_001, 'new-turn');
    desks().events.delivered(lea?.id ?? '', 1_002);
    const view = (id: string | undefined) => company.view().messages.find((m) => m.id === id);
    expect(view(ada?.id)).toMatchObject({ deliveredAt: 1_000, deliveredHow: 'next-step' });
    expect(view(kai?.id)).toMatchObject({ deliveredAt: 1_001, deliveredHow: 'new-turn' });
    // A desk that doesn't say how leaves it out.
    expect(view(lea?.id)?.deliveredAt).toBe(1_002);
    expect(view(lea?.id)).not.toHaveProperty('deliveredHow');
  });

  it("lets the CEO reach everyone and a head their room, and refuses the rest in the org rules' words", async () => {
    const { company, desks } = await rig({ running: true });
    const all = company.send('ceo', { to: { kind: 'everyone' }, text: 'Launch is Monday.', for: [] });
    expect(all.map((m) => m.to)).toEqual(['head-of-design', 'ui-designer', 'ux-designer', 'head-of-engineering', 'frontend-lead', 'frontend-engineer', 'office-manager']);
    expect(desks().textsFor('frontend-engineer').at(-1)).toBe('From Noor, CEO, to everyone: Launch is Monday.');
    expect(company.send('head-of-design', { to: design, text: 'Crits at four.', for: [] }).map((m) => m.to)).toEqual(['ui-designer', 'ux-designer']);
    expect(refusal(() => company.send('ui-designer', { to: { kind: 'everyone' }, text: 'Hi all.', for: [] }))).toMatchObject({
      code: 'not-allowed',
      message: 'Only the CEO messages everyone; ask Ada to pass this on.',
    });
    // One person goes by the same rules as message, and a refusal keeps nothing.
    const before = company.view().messages.length;
    expect(refusal(() => company.send('ui-designer', { to: to('frontend-engineer'), text: 'Use my tokens.', for: [] })).message).toBe(
      'Kai can message their manager, their own team and their reports; ask Ada to pass this on.',
    );
    expect(company.view().messages).toHaveLength(before);
  });

  it('counts a person writing back with send as their reply, so no second one is posted at the end of their turn', async () => {
    const { company, desks } = await rig({ running: true });
    const asked = company.say('ceo', 'How is the org coming along?');
    desks().events.delivered(asked.id, Date.now(), 'new-turn');
    company.send('ceo', { to: to(STAKEHOLDER), text: 'Drafted: eight people in three rooms.', for: [] });
    desks().events.turn('ceo', ended('I told Robin the org is drafted.'));
    expect(company.view().messages.filter((m) => m.to === STAKEHOLDER).map((m) => m.text)).toEqual(['Drafted: eight people in three rooms.']);
  });

  it('cites the message that began a turn when its last words are posted as the reply', async () => {
    const { company, desks } = await rig({ running: true });
    const asked = company.say('ceo', 'How is the org coming along?');
    desks().events.delivered(asked.id, Date.now(), 'new-turn');
    desks().events.turn('ceo', ended('Eight people in three rooms.'));
    expect(company.view().messages.find((m) => m.turnReply)).toMatchObject({ text: 'Eight people in three rooms.', cites: [asked.id] });
  });

  it('passes on whom the stakeholder means it for with each relay, and each turn on the way says so', async () => {
    const { company, desks } = await rig({ running: true });
    const [toCeo] = company.send(STAKEHOLDER, { to: to('ceo'), text: WORDS, for: ['ui-designer'] });
    expect(desks().textsFor('ceo').at(-1)).toBe(`From Robin, the stakeholder: ${WORDS}\n\nRobin means this for Kai, UI designer.`);
    const [toAda] = company.relay('ceo', { message: toCeo?.id ?? '', to: ['head-of-design'], note: 'Mostly the buttons.' });
    expect(toAda?.for).toEqual(['ui-designer']);
    expect(desks().textsFor('head-of-design').at(-1)).toBe(`From Noor, CEO, passing on from Robin: ${WORDS}\n\nNoor adds: Mostly the buttons.\n\nRobin means this for Kai, UI designer.`);
    company.relay('head-of-design', { message: toAda?.id ?? '', to: ['ui-designer'], note: null });
    expect(desks().textsFor('ui-designer').at(-1)).toBe(`From Ada, head of design, passing on from Robin: ${WORDS}\n\nRobin means this for you.`);
  });

  it('keeps an all-hands longer than one line of the log over several lines, and everyone gets it, after a restart too', async () => {
    const { company, desks, root, reopen } = await rig();
    const proposed = company.proposeOrg('ceo', bigProposal());
    if (!proposed.ok) throw new Error(proposed.errors.join('; '));
    company.start();
    await company.idle();
    const lines = () => logText(root).trim().split('\n').length;
    const before = lines();
    // Three bytes a character: 4,000 of them make each copy about 12 KB, and 24 copies more than one 256 KB line.
    const words = '名前は何ですか。'.repeat(500);
    const copies = company.send('ceo', { to: { kind: 'everyone' }, text: words, for: [] });
    expect(copies).toHaveLength(24);
    expect(copies.every((m) => m.text === words && m.audience?.group === copies[0]?.id)).toBe(true);
    expect(new Set(desks().turns.filter((t) => copies.some((m) => m.id === t.turn.messageId)).map((t) => t.plan.person.id)).size).toBe(24);
    expect(lines() - before).toBeGreaterThan(1);
    const copy = crashCopy(root);
    const after = reopen(copy);
    try {
      expect(after.view().messages.filter((m) => m.audience?.group === copies[0]?.id)).toHaveLength(24);
    } finally {
      await after.close();
    }
    expect(eventsFile(copy)).not.toBe(eventsFile(root));
  });

  it('refuses once the company is closed', async () => {
    const { company } = await rig({ running: true });
    await company.close();
    expect(refusal(() => company.send(STAKEHOLDER, { to: design, text: WORDS, for: [] })).code).toBe('closed');
  });
});

describe('acknowledgements, Remind and Escalate, through the company', () => {
  /** "Make the palette darker" to the CEO for Kai, passed on to Ada; both delivered, and Kai has nothing yet. */
  async function forKai() {
    const r = await rig({ running: true });
    const [toCeo] = r.company.send(STAKEHOLDER, { to: to('ceo'), text: WORDS, for: ['ui-designer'] });
    if (!toCeo) throw new Error('No message.');
    r.desks().events.delivered(toCeo.id, Date.now(), 'next-step');
    const [toAda] = r.company.relay('ceo', { message: toCeo.id, to: ['head-of-design'], note: null });
    if (!toAda) throw new Error('No relay.');
    r.desks().events.delivered(toAda.id, Date.now(), 'new-turn');
    return { ...r, toCeo, toAda };
  }

  it('keeps an acknowledgement, replaces it when given again, and has it after a restart', async () => {
    const { company, desks, root, reopen } = await rig({ running: true });
    const [toKai] = company.send(STAKEHOLDER, { to: to('ui-designer'), text: WORDS, for: [] });
    const id = toKai?.id ?? '';
    desks().events.delivered(id, Date.now(), 'new-turn');
    const first = company.ack('ui-designer', { message: id, agree: true, text: 'On it.' });
    expect(first).toMatchObject({ message: id, by: 'ui-designer', agree: true, text: 'On it.' });
    const second = company.ack('ui-designer', { message: id, agree: false, text: '  Espresso brown fails contrast;\ntrying charcoal.  ' });
    expect(second).toMatchObject({ id: first.id, agree: false, text: 'Espresso brown fails contrast; trying charcoal.' });
    expect(logText(root)).toContain(`"type":"ack"`);
    expect(refusal(() => company.ack('ux-designer', { message: id, agree: true, text: 'Mine too.' })).code).toBe('not-allowed');
    // What Remind says shows the acknowledgement it holds: from the log after a crash, and from company.json after a close.
    const said = (c: { remind: typeof company.remind }) => c.remind(STAKEHOLDER, { message: id, person: 'ui-designer' }).text;
    const crashed = reopen(crashCopy(root));
    try {
      expect(said(crashed)).toContain('You acknowledged it: “Espresso brown fails contrast; trying charcoal.”');
    } finally {
      await crashed.close();
    }
    await company.close();
    const reopened = reopen();
    try {
      expect(said(reopened)).toContain('You acknowledged it: “Espresso brown fails contrast; trying charcoal.”');
    } finally {
      await reopened.close();
    }
  });

  it('reminds the person who holds it, from the office, citing it, once while the reminder waits', async () => {
    const { company, desks, toCeo, toAda } = await forKai();
    const reminder = company.remind(STAKEHOLDER, { message: toCeo.id, person: 'head-of-design' });
    expect(reminder).toMatchObject({ from: THE_OFFICE, to: 'head-of-design', cites: [toCeo.id, toAda.id], deliveredAt: null });
    expect(desks().textsFor('head-of-design').at(-1)).toBe(
      [
        `From the office: A reminder about message ${toAda.id}, which Noor passed on from Robin: “${WORDS}”`,
        `Robin means it for Kai, UI designer, who hasn't got it yet: pass it on with relay (message ${toAda.id}).`,
        `Acknowledge it with ack (message ${toAda.id}): one sentence on what you will do with it, or why you disagree.`,
      ].join('\n\n'),
    );
    const turns = desks().turns.length;
    expect(company.remind(STAKEHOLDER, { message: toCeo.id, person: 'head-of-design' }).id).toBe(reminder.id);
    expect(desks().turns).toHaveLength(turns);
    expect(company.view().messages.find((m) => m.id === reminder.id)?.cites).toEqual([toCeo.id, toAda.id]);
  });

  it("escalates to the manager of someone it hasn't reached, who is told they have it to pass on", async () => {
    const { company, desks, toCeo, toAda } = await forKai();
    const escalation = company.escalate(STAKEHOLDER, { message: toCeo.id, person: 'ui-designer' });
    expect(escalation).toMatchObject({ from: THE_OFFICE, to: 'head-of-design', cites: [toCeo.id] });
    expect(desks().textsFor('head-of-design').at(-1)).toContain(`hasn't reached Kai, UI designer, and Robin means it for them. You have it as message ${toAda.id}: pass it on with relay.`);
    // Above Ada it goes to the CEO, and nobody is above the CEO but the stakeholder.
    expect(company.escalate(STAKEHOLDER, { message: toCeo.id, person: 'head-of-design' }).to).toBe('ceo');
    expect(refusal(() => company.escalate(STAKEHOLDER, { message: toCeo.id, person: 'ceo' })).message).toBe('Noor, the CEO, answers only to you; remind them instead.');
  });

  it("refuses Remind and Escalate from anyone but the stakeholder, and about messages that aren't the stakeholder's", async () => {
    const { company, toCeo } = await forKai();
    expect(refusal(() => company.remind('ceo', { message: toCeo.id, person: 'head-of-design' })).code).toBe('not-allowed');
    expect(refusal(() => company.escalate('head-of-design', { message: toCeo.id, person: 'ui-designer' })).code).toBe('not-allowed');
    const fromAda = company.message('head-of-design', 'ui-designer', 'Darker, please.');
    expect(refusal(() => company.remind(STAKEHOLDER, { message: fromAda.id, person: 'ui-designer' })).message).toBe('Only your own messages have a trace to follow up.');
  });
});

describe('what a report, a status line or a task cites, through the company', () => {
  it('keeps the messages they answer, among those the person had', async () => {
    const { company } = await rig({ running: true });
    const [toKai] = company.send(STAKEHOLDER, { to: to('ui-designer'), text: WORDS, for: [] });
    const [toAda] = company.send(STAKEHOLDER, { to: to('head-of-design'), text: 'Darker palette across the site.', for: [] });
    const kai = toKai?.id ?? '';
    const report = company.report('ui-designer', { taskId: null, outcome: 'progress', text: 'Espresso brown on the buttons.', cites: [kai, kai] });
    expect(report.cites).toEqual([kai]);
    expect(company.view().reports.find((r) => r.id === report.id)?.cites).toEqual([kai]);
    const status = company.postStatus('ui-designer', 'Darkening the palette.', null, [kai]);
    expect(company.view().statuses.at(-1)).toEqual(status);
    expect(status.cites).toEqual([kai]);
    const task = company.assign('head-of-design', {
      to: 'ui-designer', title: 'Darker palette', brief: 'Darken the palette across the site.', files: ['src/theme'], doneWhen: 'Buttons pass 4.5:1.',
      parent: null, milestone: null, worktree: false, cites: [toAda?.id ?? ''],
    });
    expect(company.view().tasks.find((t) => t.id === task.id)?.cites).toEqual([toAda?.id]);
    // Without cites the records keep their shape.
    expect(company.report('ui-designer', { taskId: null, outcome: 'progress', text: 'Still on it.' })).not.toHaveProperty('cites');
  });

  it("refuses a message the person never had, so a report can't land in an unrelated message's trace", async () => {
    const { company } = await rig({ running: true });
    const [toSam] = company.send(STAKEHOLDER, { to: to('frontend-engineer'), text: 'Bigger slots.', for: [] });
    const reports = company.view().reports.length;
    expect(refusal(() => company.report('ui-designer', { taskId: null, outcome: 'progress', text: 'Done.', cites: [toSam?.id ?? ''] }))).toMatchObject({
      code: 'not-allowed',
      message: `Kai can cite only messages sent to them or by them, and message ${toSam?.id} is neither.`,
    });
    expect(company.view().reports).toHaveLength(reports);
    expect(refusal(() => company.postStatus('ui-designer', 'Done.', null, ['m-999'])).code).toBe('unknown');
  });
});

describe('a message that stays a message', () => {
  it('keeps its old shape when it has no audience, no one it is for and cites nothing', async () => {
    const { company } = await rig({ running: true });
    const m: Message = company.say('ui-designer', WORDS);
    for (const field of ['audience', 'for', 'cites', 'deliveredHow']) expect(m).not.toHaveProperty(field);
  });
});
