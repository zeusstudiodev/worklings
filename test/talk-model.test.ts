import { describe, expect, it } from 'vitest';
import type { CompanyView, Message } from '../src/core/company.ts';
import type { Recipient } from '../src/core/steering.ts';
import { paletteCommands } from '../web/src/company/palette/paletteModel.ts';
import {
  type CallResult,
  choiceList,
  commandList,
  counterLine,
  effectiveTo,
  forList,
  forPeopleOf,
  groupForPicks,
  initialTalk,
  isEmpty,
  keepSent,
  listStatus,
  mentionsIn,
  NO_COMMAND,
  optionsOf,
  pickList,
  readHistory,
  readKept,
  keep,
  sendOutcome,
  sendPlan,
  type Sent,
  stillThere,
  goneLine,
  talkChoices,
  talkReducer,
  type TalkState,
  toWords,
  triggerAt,
  typedPicks,
  forWords,
  whatHappens,
  wordsLine,
  wordsToSend,
} from '../web/src/company/talk/talkModel.ts';
import { company, desk, message, NOW, person, studio, update, withPeople } from './panels-work-kit.ts';

const snap = { studio };
const kai: Recipient = { kind: 'person', id: 'frontend-engineer' };
const mina: Recipient = { kind: 'person', id: 'ui-designer' };
const ada: Recipient = { kind: 'person', id: 'head-of-design' };
const ceo: Recipient = { kind: 'person', id: 'ceo' };
const design: Recipient = { kind: 'room', id: 'design' };
const engineering: Recipient = { kind: 'room', id: 'engineering' };
const adasTeam: Recipient = { kind: 'team', head: 'head-of-design' };
const everyone: Recipient = { kind: 'everyone' };

/** The café at work: Kai working, Mina working, everyone else at rest. */
function cafe(): CompanyView {
  return update(update(company(), 'frontend-engineer', { desk: desk('working') }), 'ui-designer', { desk: desk('working') });
}

const choicesOf = (c: CompanyView = cafe(), steering = true) => talkChoices(snap, c, NOW, { steering });

/** Memory storage, as localStorage and sessionStorage behave. */
function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('who a typed @ names', () => {
  const choices = choicesOf();
  const resolved = (text: string) => mentionsIn(text, choices).mentions.map((m) => [m.raw, m.leading, m.resolved.kind === 'choice' ? m.resolved.choice.key : m.resolved.kind]);

  it('names someone only by an exact first name, title, room or team, case and accents ignored, the longest that matches', () => {
    expect(resolved('@kai make the buttons bigger')).toEqual([['@kai', true, 'person:frontend-engineer']]);
    expect(resolved('@Head of design, please look')).toEqual([['@Head of design', true, 'person:head-of-design']]);
    expect(resolved('@DESIGN darker cards')).toEqual([['@DESIGN', true, 'room:design']]);
    expect(resolved("@ada's team: darker cards")).toEqual([["@ada's team", true, 'team:head-of-design']]);
    expect(resolved('@Nóor hello')).toEqual([['@Nóor', true, 'person:ceo']]);
    expect(resolved('@QA engineer can you')).toEqual([['@QA engineer', true, 'person:qa-engineer']]);
  });

  it('leaves anything else as words and says so', () => {
    const { mentions } = mentionsIn('@ka make it', choices);
    expect(mentions.map((m) => m.resolved.kind)).toEqual(['none']);
    expect(mentions[0] && wordsLine(mentions[0], choices)).toBe("@ka isn't anyone's name, so it stays as words.");
  });

  it('keeps a name two people share as words, and asks for a pick', () => {
    const twoSams = withPeople(cafe(), (people) => [...people, person('sam-a', 'Sam', 'Copywriter', 'design'), person('sam-b', 'Sam', 'Data analyst', 'engineering')]);
    const choices = choicesOf(twoSams);
    const { mentions } = mentionsIn('@sam can you check', choices);
    expect(mentions[0]?.resolved).toEqual({ kind: 'ambiguous', count: 2 });
    expect(mentions[0] && wordsLine(mentions[0], choices)).toBe('Two people are called sam, so it stays as words. Pick one from the list.');
  });

  it('reaches all hands only by @all, @everyone or @all-hands', () => {
    for (const text of ['@all hello', '@everyone hello', '@All-hands hello']) expect(resolved(text)[0]?.[2]).toBe('everyone');
    expect(resolved('@al hello')[0]?.[2]).toBe('none');
  });

  it('opens nothing for an @ inside a word, as in an email address', () => {
    expect(mentionsIn('mail kai@example.com today', choices).mentions).toEqual([]);
    expect(triggerAt('mail kai@ex', 11, choices)).toBeNull();
  });

  it('reads @ at the start as who hears it and @ after the first word as who it is for', () => {
    const text = '@Ada ask @Kai to darken the palette';
    const { mentions, wordsFrom } = mentionsIn(text, choices);
    expect(typedPicks(mentions)).toEqual([ada]);
    expect(forPeopleOf(mentions, [])).toEqual(['frontend-engineer']);
    expect(forPeopleOf(mentions, ['frontend-engineer'])).toEqual([]);
    expect(wordsToSend(text, mentions, wordsFrom)).toBe('ask @Kai to darken the palette');
  });

  it('lets several picks before the first word all hear it, and sends only the words', () => {
    const text = '@Kai @Mina, make the buttons bigger';
    const { mentions, wordsFrom } = mentionsIn(text, choices);
    expect(typedPicks(mentions)).toEqual([kai, mina]);
    expect(wordsToSend(text, mentions, wordsFrom)).toBe('make the buttons bigger');
  });

  it('keeps a leading @ that names nobody in the words it sends', () => {
    const text = '@Kai @zz hello';
    const { mentions, wordsFrom } = mentionsIn(text, choices);
    expect(wordsToSend(text, mentions, wordsFrom)).toBe('@zz hello');
  });

  it('keeps a name a list pick wrote as the one picked, even when two share it', () => {
    const twoSams = choicesOf(withPeople(cafe(), (people) => [...people, person('sam-a', 'Sam', 'Copywriter', 'design'), person('sam-b', 'Sam', 'Data analyst', 'engineering')]));
    const { mentions } = mentionsIn('ask @Sam to check', twoSams, { '@sam': 'person:sam-b' });
    expect(forPeopleOf(mentions, [])).toEqual(['sam-b']);
  });
});

describe('what the caret is typing', () => {
  const choices = choicesOf();
  it('opens the @ list at the start, after the first word, and / at the very start', () => {
    expect(triggerAt('@de', 3, choices)).toEqual({ kind: 'mention', at: 0, query: 'de', leading: true });
    expect(triggerAt('@Kai @mi', 8, choices)).toEqual({ kind: 'mention', at: 5, query: 'mi', leading: true });
    expect(triggerAt('ask @mi', 7, choices)).toEqual({ kind: 'mention', at: 4, query: 'mi', leading: false });
    expect(triggerAt('/pause des', 10, choices)).toEqual({ kind: 'command', query: 'pause des' });
    expect(triggerAt('say /pause', 10, choices)).toBeNull();
  });

  it('keeps the list open across spaces only while the words still match someone', () => {
    expect(triggerAt('@head of', 8, choices)).toMatchObject({ kind: 'mention', query: 'head of' });
    expect(triggerAt('@kai make', 9, choices)).toBeNull();
  });
});

describe('the lists', () => {
  const choices = choicesOf();
  const titles = (groups: ReturnType<typeof pickList>) => groups.map((g) => [g.title, g.options.map((o) => o.label)]);

  it('groups the @ list as rooms, teams and people, filtered by any word of a name, title or room', () => {
    expect(titles(pickList(choices, 'de', []))).toEqual([
      ['Rooms', ['The design room']],
      ['Teams', ["Ada's team"]],
      ['People', ['Ada, head of design', 'Mina, UI designer']],
    ]);
  });

  it('puts the person whose first name you typed on top', () => {
    expect(titles(pickList(choices, 'k', []))[0]).toEqual(['People', ['Kai, frontend engineer']]);
    expect(pickList(choices, 'k', [])[0]?.options[0]?.match).toEqual([0, 1]);
  });

  it('offers all hands only from "al" or "ev"', () => {
    expect(pickList(choices, 'a', []).map((g) => g.title)).not.toContain('All hands');
    expect(pickList(choices, 'al', [])[0]?.title).toBe('All hands');
    expect(pickList(choices, 'ev', [])[0]?.options[0]?.label).toBe('All hands');
  });

  it("leaves out who is picked already", () => {
    expect(optionsOf(pickList(choices, 'k', [kai])).map((o) => o.label)).not.toContain('Kai, frontend engineer');
  });

  it('offers, from the fourth person picked, the room or team that holds them all', () => {
    const four: Recipient[] = [{ kind: 'person', id: 'head-of-engineering' }, { kind: 'person', id: 'frontend-lead' }, kai, { kind: 'person', id: 'qa-engineer' }];
    expect(groupForPicks(choices, four.slice(0, 3))).toBeNull();
    const offered = groupForPicks(choices, four);
    expect(offered?.label).toBe('The engineering room, all four of them');
    expect(pickList(choices, '', four)[0]?.options[0]?.pick).toMatchObject({ kind: 'pick', replaces: four });
  });

  it('lists who it is for after the first word, people only, ending with "Send it to … instead"', () => {
    const [group] = forList(choices, 'mi');
    expect(group?.title).toBe("Who it's for. You'll see if it reaches them.");
    expect(group?.options.map((o) => o.label)).toEqual(['Mina, UI designer', 'Send it to Mina instead']);
    expect(group?.options.at(-1)?.pick.kind).toBe('instead');
    expect(forList(choices, 'design')).toEqual([{ title: "Who it's for. You'll see if it reaches them.", options: expect.arrayContaining([expect.objectContaining({ label: 'Ada, head of design' })]) }]);
  });

  /** Mina's task is open, so the design room can be paused. */
  const withWork = (): CompanyView => ({ ...cafe(), tasks: [{ ...taskOf('t-1'), owner: 'ui-designer' }] });

  it('finds commands by their words, and says when none match', () => {
    const commands = paletteCommands(snap, withWork(), { steering: true });
    const found = optionsOf(commandList(commands, 'pause des', [], true));
    expect(found[0]?.label).toBe('Pause the design room');
    expect(commandList(commands, 'xyzzy', [], true)).toEqual([]);
    expect(listStatus(0, 'command', 'xyzzy')).toBe(NO_COMMAND);
    // Before anything is typed: suggested first, then each section.
    const browsing = commandList(commands, '', [], true).map((g) => g.title);
    expect(browsing[0]).toBe('Suggested');
    expect(browsing).toContain('Go to');
  });

  it('marks what sends unavailable while the office reconnects', () => {
    const commands = paletteCommands(snap, withWork(), { steering: true });
    const pause = optionsOf(commandList(commands, 'pause des', [], false))[0];
    expect(pause).toMatchObject({ disabled: true, detail: 'Waits until the office is back' });
  });

  it("narrows a step's choices by what is typed", () => {
    const step = { kind: 'choice' as const, key: 'to', label: 'Who takes it over?', options: [{ value: 'kai', label: 'Kai, frontend engineer', hint: null }, { value: 'mina', label: 'Mina, UI designer', hint: null }] };
    expect(optionsOf(choiceList(step, 'mi')).map((o) => o.label)).toEqual(['Mina, UI designer']);
  });

  it('counts what matches for the status by the box, in words', () => {
    expect(listStatus(5, 'mention', 'de')).toBe('Five match. Up and Down choose, Enter picks.');
    expect(listStatus(1, 'mention', 'de')).toBe('One matches. Up and Down choose, Enter picks.');
    expect(listStatus(0, 'mention', 'zo')).toBe('No one called “zo”.');
  });
});

describe('the To in words', () => {
  const c = cafe();
  it('names one person with their title, and a short form for the compact bar', () => {
    expect(toWords(snap, c, [ceo], false)).toEqual({ long: 'To Noor, CEO', short: 'Noor', box: 'Message to Noor, CEO', placeholder: 'Say something to Noor', once: false });
    expect(toWords(snap, c, [{ kind: 'person', id: 'qa-engineer' }], false)).toMatchObject({ long: 'To the QA engineer', placeholder: 'Say something to the QA engineer' });
  });

  it('names a room, a team and all hands', () => {
    expect(toWords(snap, c, [design], true)).toMatchObject({ long: 'To the design room', short: 'Design', once: true });
    expect(toWords(snap, c, [adasTeam], false)).toMatchObject({ long: "To Ada's team", short: "Ada's team" });
    expect(toWords(snap, c, [everyone], false)).toMatchObject({ long: 'To all hands', short: 'All hands', placeholder: 'Say something to everyone' });
  });

  it('names several picks, three then how many more, with faces only in the compact bar', () => {
    expect(toWords(snap, c, [kai, mina], true)).toMatchObject({ long: 'To Kai and Mina', short: '', box: 'Message to Kai and Mina' });
    const five: Recipient[] = [kai, mina, ada, ceo, { kind: 'person', id: 'office-manager' }];
    expect(toWords(snap, c, five, true).long).toBe('To Kai, Mina, Ada and two more');
  });
});

describe('what the hint row says will happen', () => {
  const c = cafe();
  it("says what the person's desk does with it", () => {
    expect(whatHappens(snap, c, [kai], [], false, NOW)).toBe('Kai reads it at their next step.');
    expect(whatHappens(snap, c, [ada], [], false, NOW)).toBe('Ada passes it on to whoever it concerns.');
  });

  it('says who passes it on to whom it is for', () => {
    expect(whatHappens(snap, c, [ada], ['frontend-engineer'], false, NOW)).toBe('Ada gets it and passes it on to Kai.');
    expect(forWords([c.people.find((p) => p.id === 'frontend-engineer')!, c.people.find((p) => p.id === 'ui-designer')!])).toBe('For Kai and Mina, through the org');
  });

  it('says a pick is for this message only, and that several picks get a copy each', () => {
    expect(whatHappens(snap, c, [design], [], true, NOW)).toMatch(/^To the design room, for this message only\. Ada and Mina get it\./);
    expect(whatHappens(snap, c, [kai, mina], [], true, NOW)).toBe('To Kai and Mina, for this message only: a copy each.');
  });

  it('counts from 3,500 characters and says how much to cut when over', () => {
    expect(counterLine('x'.repeat(3_499)).text).toBeNull();
    expect(counterLine('x'.repeat(3_620))).toEqual({ text: '3,620 of 4,000', over: false });
    expect(counterLine('x'.repeat(4_120))).toEqual({ text: '4,120 of 4,000. Shorten it by 120 to send.', over: true });
  });
});

describe('the send plan', () => {
  const c = cafe();
  const plan = (to: Recipient[], forPeople: string[] = []) => sendPlan(snap, c, to, forPeople).map((call) => [call.title, call.via]);

  it('sends a plain message to one person as it always went, and one with someone it is for through steering', () => {
    expect(plan([kai])).toEqual([['Kai', 'say']]);
    expect(plan([ada], ['ui-designer'])).toEqual([['Ada', 'send']]);
  });

  it('gives each person one copy: a picked room or team covers its people', () => {
    expect(plan([mina, design])).toEqual([['the design room', 'send']]);
    expect(plan([kai, design])).toEqual([['Kai', 'say'], ['the design room', 'send']]);
    // Ola's team is two of the engineering room's four.
    expect(plan([{ kind: 'team', head: 'frontend-lead' }, engineering])).toEqual([['the engineering room', 'send']]);
    expect(plan([design, everyone, kai])).toEqual([['everyone', 'send']]);
  });

  it('keeps the first picked of a room and a team that hold the same people', () => {
    expect(plan([adasTeam, design])).toEqual([["Ada's team", 'send']]);
  });

  it('sends overlapping rooms and teams whole, in the To’s order', () => {
    const benTeam: Recipient = { kind: 'team', head: 'head-of-engineering' };
    expect(plan([design, engineering, benTeam])).toEqual([['the design room', 'send'], ['the engineering room', 'send']]);
  });
});

describe('what a send says', () => {
  const c = cafe();
  const calls = sendPlan(snap, c, [kai, mina], []);
  const copy = (id: string, to: string): Message => message(id, '@stakeholder', to, 'Make the buttons bigger.');
  const [toKai, toMina] = calls;

  it('says it was sent and what happens next', () => {
    const [one] = sendPlan(snap, c, [kai], []);
    const out = one ? sendOutcome(snap, c, [{ call: one, ok: true, messages: [copy('m-1', 'frontend-engineer')] }], NOW) : null;
    expect(out).toMatchObject({ state: 'sent', line: 'Sent. Kai reads it at their next step.', retry: [] });
    expect(out?.sent.map((m) => m.id)).toEqual(['m-1']);
  });

  it('says who got it when only some copies went, and tries again only for the rest', () => {
    if (!toKai || !toMina) throw new Error('two calls');
    const results: CallResult[] = [
      { call: toKai, ok: true, messages: [copy('m-1', 'frontend-engineer')] },
      { call: toMina, ok: false, why: 'Mina is stopping.' },
    ];
    const out = sendOutcome(snap, c, results, NOW);
    expect(out).toMatchObject({ state: 'partly', line: 'Sent to Kai. Couldn’t send to Mina: Mina is stopping.'.replace('’', "'"), gone: false });
    expect(out.retry).toEqual([toMina]);
  });

  it('says a refusal once for several with the same reason', () => {
    if (!toKai || !toMina) throw new Error('two calls');
    const out = sendOutcome(snap, c, [{ call: toKai, ok: false, why: "The office didn't answer." }, { call: toMina, ok: false, why: "The office didn't answer." }], NOW);
    expect(out).toMatchObject({ state: 'refused', line: "Couldn't send: The office didn't answer.", retry: [toKai, toMina] });
  });

  it('says when its person left, so the bar offers to send to the CEO instead', () => {
    if (!toKai) throw new Error('a call');
    const without = withPeople(c, (people) => people.filter((p) => p.id !== 'frontend-engineer'));
    const out = sendOutcome(snap, without, [{ call: toKai, ok: false, why: 'Not in this company.' }], NOW);
    expect(out).toMatchObject({ state: 'refused', line: "Couldn't send: Kai left the company.", gone: true });
  });
});

describe('history and what the tab keeps', () => {
  it('keeps the last 50 sent with their To, newest first, per company', () => {
    const storage = memory();
    for (let i = 0; i < 55; i++) keepSent(storage, 'cafe~1', { text: `message ${i}`, to: [kai] });
    const history = readHistory(storage, 'cafe~1');
    expect(history).toHaveLength(50);
    expect(history[0]).toEqual({ text: 'message 54', to: [kai] });
    expect(readHistory(storage, 'other~2')).toEqual([]);
  });

  it('reads back only well-formed entries, and works without storage', () => {
    const storage = memory();
    storage.setItem('worklings-talk-history:cafe~1', JSON.stringify([{ text: 'ok', to: [{ kind: 'room', id: 'design' }] }, { text: 1, to: [] }, { text: 'bad', to: [{ kind: 'nope' }] }, 'junk']));
    expect(readHistory(storage, 'cafe~1')).toEqual([{ text: 'ok', to: [design] }]);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readHistory(broken, 'cafe~1')).toEqual([]);
    expect(keepSent(broken, 'cafe~1', { text: 'x', to: [kai] })).toEqual([{ text: 'x', to: [kai] }]);
  });

  it('keeps the To and the draft for the tab', () => {
    const storage = memory();
    keep(storage, 'cafe~1', { to: design, draft: 'half a thought' });
    expect(readKept(storage, 'cafe~1')).toEqual({ to: design, draft: 'half a thought' });
    storage.setItem('worklings-talk:cafe~2', '{"to":{"kind":"person"},"draft":7}');
    expect(readKept(storage, 'cafe~2')).toEqual({ to: null, draft: '' });
  });
});

describe('the To when someone leaves', () => {
  it('knows who is still there and says the To falls back to the CEO', () => {
    const c = cafe();
    const without = withPeople(c, (people) => people.filter((p) => p.id !== 'frontend-engineer' && p.id !== 'ui-designer'));
    expect(stillThere(snap, without, kai)).toBe(false);
    expect(stillThere(snap, without, design)).toBe(true);
    expect(stillThere(snap, withPeople(without, (people) => people.filter((p) => p.room !== 'design')), adasTeam)).toBe(false);
    expect(goneLine(snap, c, kai)).toBe('Kai left the company. To the CEO now.');
    expect(goneLine(snap, c, adasTeam)).toBe("Ada's team is gone. To the CEO now.");
  });

  it('says nothing of someone the office never knew, and names the fired from the studio', () => {
    const c = cafe();
    expect(goneLine(snap, c, { kind: 'person', id: 'nobody-here' })).toBeNull();
    const fired = { ...snap, studio: { ...studio, fired: [{ id: 'sam', department: 'design', title: 'Copywriter', file: 'x.md', name: 'Sam' }] } };
    expect(goneLine(fired, c, { kind: 'person', id: 'sam' })).toBe('Sam left the company. To the CEO now.');
  });
});

describe("the bar's state", () => {
  const history: Sent[] = [{ text: 'Make the palette darker.', to: [ceo] }, { text: 'Bigger buttons, please.', to: [kai, mina] }];
  const start = (extra: Partial<TalkState> = {}): TalkState => ({ ...initialTalk(ceo), ...extra });
  const run = (s: TalkState, ...actions: Parameters<typeof talkReducer>[1][]) => actions.reduce(talkReducer, s);

  it('makes someone you open the To only while the box is empty', () => {
    expect(run(start(), { type: 'offer', to: kai }).base).toEqual(kai);
    const writing = run(start({ draft: 'half a thought' }), { type: 'offer', to: kai });
    expect(writing.base).toEqual(ceo);
    expect(writing.draft).toBe('half a thought');
  });

  it('changes the To on "Message Kai" even with words in the box, and suggests words only into an empty box', () => {
    expect(run(start({ draft: 'half a thought' }), { type: 'to', to: kai })).toMatchObject({ base: kai, draft: 'half a thought' });
    expect(run(start(), { type: 'to', to: ceo, draft: 'Hire ' }).draft).toBe('Hire ');
    expect(run(start({ draft: 'mine' }), { type: 'to', to: ceo, draft: 'Hire ' }).draft).toBe('mine');
  });

  it('ends Stop when someone else is opened, and keeps the words', () => {
    const stopping = run(start({ draft: 'leave the push' }), { type: 'stop', person: 'frontend-engineer' });
    expect(run(stopping, { type: 'offer', to: kai }).stop).toBe('frontend-engineer');
    const other = run(stopping, { type: 'offer', to: mina });
    expect(other).toMatchObject({ stop: null, draft: 'leave the push', base: ceo });
  });

  it('takes a picked @ out of the box as who hears it, for this message only; Backspace in the empty box drops it', () => {
    const picked = run(start({ draft: '@de darker cards' }), { type: 'pick', to: design, start: 0, end: 3, replaces: [] });
    expect(picked).toMatchObject({ draft: 'darker cards', picks: [design] });
    expect(effectiveTo(picked, [], null)).toEqual({ to: [design], once: true });
    const emptied = run(picked, { type: 'type', text: '', history }, { type: 'drop-pick' });
    expect(effectiveTo(emptied, [], null)).toEqual({ to: [ceo], once: false });
  });

  it('comes back to the To you set after sending', () => {
    const sent = run(start({ draft: 'darker', picks: [design] }), { type: 'sent' });
    expect(sent).toMatchObject({ draft: '', picks: [], base: ceo });
    expect(isEmpty(sent)).toBe(true);
  });

  it('writes who it is for and keeps it to the one picked; "Not for Kai" takes it back', () => {
    const s = run(start({ draft: 'ask @ka to darken it' }), { type: 'pick-for', key: 'person:frontend-engineer', name: 'Kai', start: 4, end: 7 });
    expect(s.draft).toBe('ask @Kai to darken it');
    expect(s.bound).toEqual({ '@kai': 'person:frontend-engineer' });
    expect(run(s, { type: 'not-for', person: 'frontend-engineer' }).notFor).toEqual(['frontend-engineer']);
    const instead = run(start({ draft: 'ask @ka to darken it' }), { type: 'instead', to: kai, start: 4, end: 7 });
    expect(instead).toMatchObject({ draft: 'ask to darken it', picks: [kai] });
  });

  it("steps through a command's steps and back to the list with what was typed", () => {
    const [cancel] = paletteCommands(snap, { ...cafe(), tasks: [{ ...taskOf('t-1') }] }, { steering: true }).filter((c) => c.action.kind === 'reassign-task');
    if (!cancel) throw new Error('a reassign command');
    let s = run(start({ draft: '/reassign' }), { type: 'command', command: cancel, typed: '/reassign' });
    expect(s.command?.at).toBe(0);
    s = run(s, { type: 'answer', key: 'to', value: 'ui-designer' }, { type: 'type', text: 'the brief is in the task', history });
    expect(s).toMatchObject({ step: 'the brief is in the task', command: { at: 1, values: { to: 'ui-designer' } } });
    s = run(s, { type: 'step-back' });
    expect(s.command?.at).toBe(0);
    s = run(s, { type: 'step-back' });
    expect(s).toMatchObject({ command: null, draft: '/reassign' });
  });

  it('puts refused words back unless something new was started', () => {
    expect(run(start(), { type: 'refused', text: 'Hold the push', to: [kai] })).toMatchObject({ draft: 'Hold the push', picks: [kai] });
    expect(run(start({ draft: 'new words' }), { type: 'refused', text: 'Hold the push', to: [kai] }).draft).toBe('new words');
  });

  it('brings back what you sent with Up, with its To; Down and Escape return to the draft; editing keeps it', () => {
    let s = run(start(), { type: 'recall', dir: 'older', history });
    expect(s.recall).toBe(0);
    expect(effectiveTo(s, [], history[0] ?? null)).toEqual({ to: [ceo], once: false });
    s = run(s, { type: 'recall', dir: 'older', history });
    expect(effectiveTo(s, [], history[1] ?? null)).toEqual({ to: [kai, mina], once: true });
    expect(run(s, { type: 'recall', dir: 'older', history }).recall).toBe(1);
    expect(run(s, { type: 'recall', dir: 'newer', history }, { type: 'recall', dir: 'newer', history }).recall).toBeNull();
    expect(run(s, { type: 'unrecall' }).recall).toBeNull();
    const edited = run(s, { type: 'type', text: 'Bigger buttons, please. Today.', history });
    expect(edited).toMatchObject({ recall: null, draft: 'Bigger buttons, please. Today.', picks: [kai, mina] });
  });

  it('falls back to the CEO when the To’s person leaves, and drops picks of people who left', () => {
    const s = run(start({ base: kai, picks: [mina, design] }), { type: 'fallback', to: ceo, drop: ['person:ui-designer'] });
    expect(s).toMatchObject({ base: ceo, picks: [design] });
  });
});

function taskOf(id: string) {
  return {
    id,
    title: 'Cart summary',
    brief: 'b',
    owner: 'frontend-engineer',
    askedBy: 'head-of-engineering',
    files: [],
    doneWhen: 'd',
    status: 'working' as const,
    outcome: null,
    parent: null,
    milestone: null,
    worktree: null,
    commit: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
