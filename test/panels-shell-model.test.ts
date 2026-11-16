import { describe, expect, it } from 'vitest';
import { emptyAsideView } from '../src/core/aside.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { type CompanyView, type LobbyCompany, type LobbyView, type Question, STAKEHOLDER, THE_OFFICE } from '../src/core/company.ts';
import { demoCompanyView, demoLobby, demoProposalView } from '../src/core/demo-company.ts';
import {
  companyNews,
  companySpend,
  companyState,
  companyTitle,
  cutMiddle,
  desksLine,
  heldCount,
  hubProblem,
  lobbyNews,
  lobbyRow,
  lobbyTitle,
  oneSentence,
  otherNeeds,
  reconnectingLine,
  shortName,
  shortTime,
  shownText,
  showsStateCallout,
  spendWords,
  type StateInput,
  stateOfCompany,
  stateOfEntry,
  totalNeeds,
  workingNow,
} from '../web/src/company/model.ts';
import { approval, company, desk, person, question, task, update } from './panels-work-kit.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);
const clock = (at: number) => new Date(at).toISOString().slice(11, 16);
const MIN = 60_000;

/** The item at `i`, or a failed test that says which one was missing. */
function must<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) throw new Error(`no item ${i}`);
  return item;
}

const base: StateInput = { phase: 'running', pause: null, problem: null, working: 0, waiting: 0, milestone: null, lastReport: null };

describe("the company's state", () => {
  it('says each row of the state table', () => {
    const say = (s: Partial<StateInput>) => companyState({ ...base, ...s }, NOW, clock);
    expect(say({ phase: 'founding' })).toEqual({ pill: 'Drafting the org', tone: 'working', sentence: 'The CEO is drafting your company.' });
    expect(say({ phase: 'proposed' })).toEqual({ pill: 'Proposal ready', tone: 'needs', sentence: "The CEO's proposal is ready for you." });
    expect(say({ phase: 'proposed', starting: true })).toEqual({ pill: 'Starting', tone: 'working', sentence: 'Hiring everyone and putting the project on its own branch.' });
    expect(say({ working: 6, waiting: 2, milestone: 'Pickup orders work' })).toEqual({ pill: 'Working', tone: 'working', sentence: 'Six at work on “Pickup orders work”. Two wait for a desk.' });
    expect(say({ working: 1, waiting: 1 }).sentence).toBe('One at work. One waits for a desk.');
    expect(say({ lastReport: { who: 'Kai', at: NOW - 25 * MIN } })).toEqual({ pill: 'Idle', tone: 'neutral', sentence: 'Nobody is at work. Last report 25 min ago from Kai.' });
    const until = Date.UTC(2026, 10, 5, 14, 0);
    expect(say({ pause: { reason: 'usage-limit', since: NOW, until, message: '' } })).toEqual({
      pill: 'Resting until 14:00', tone: 'rest', sentence: "Resting until 14:00, when your plan's limit resets. Work picks up by itself.",
    });
    expect(say({ pause: { reason: 'overloaded', since: NOW, until: until + 5 * MIN, message: '' } }).sentence).toBe('Resting until 14:05: Claude is overloaded.');
    expect(say({ pause: { reason: 'stakeholder', since: Date.UTC(2026, 10, 5, 13, 10), until: null, message: '' } })).toEqual({ pill: 'Paused by you', tone: 'rest', sentence: 'You paused work at 13:10.' });
    expect(say({ phase: 'stopped' })).toEqual({ pill: 'Stopped', tone: 'neutral', sentence: 'Stopped. Nobody works until you resume it.' });
    const problem = "Its folder isn't at C:\\Users\\you\\plant-pal any more.";
    expect(say({ problem, working: 3 })).toEqual({ pill: "Can't run", tone: 'error', sentence: problem });
  });

  it("keeps the pill short by the browser's clock: the time without the day period, the sentence in full", () => {
    const until = Date.UTC(2026, 10, 5, 15, 45);
    expect(shortTime(until)).toMatch(/^\d{1,2}:\d{2}$/);
    const resting = companyState({ ...base, pause: { reason: 'usage-limit', since: NOW, until, message: '' } }, NOW);
    expect(resting.pill).toBe(`Resting until ${shortTime(until)}`);
    expect(resting.sentence.startsWith(`Resting until ${hourMinute(until)}, when your plan's limit resets.`)).toBe(true);
  });

  it('reads a company that is starting from its view, so a reload mid-start still says so', () => {
    const plant = demoProposalView(NOW);
    expect(stateOfCompany(plant, NOW).starting).toBe(false);
    expect(companyState(stateOfCompany({ ...plant, starting: true }, NOW), NOW, clock).pill).toBe('Starting');
  });

  it('reads the café: who works on which milestone, who waits, the latest report', () => {
    const cafe = demoCompanyView(NOW);
    const state = stateOfCompany(cafe, NOW);
    // Eight desks are at work, but two of those people (Kai's push, Theo's branch delete) wait on you. Mina's and
    // Mara's questions ended their turns, and the office's "start?" before Lena's next task leaves her at work.
    expect(state).toMatchObject({ phase: 'running', working: 6, held: 2, waiting: 1, milestone: 'Pickup orders work' });
    expect(companyState(state, NOW, clock).sentence).toBe("Six at work on “Pickup orders work”. Two wait for you. The CEO's plan waits for your approval. One waits for a desk.");
    expect(state.lastReport?.who).toBe('Sofia');
  });

  it('counts a step held for your OK or answer as waiting for you, not at work', () => {
    const c = company({
      desks: { working: 4, waiting: 0, max: 8 },
      approvals: [approval('a1', 'frontend-engineer', 'Push the work branch', { askedAt: NOW - 3 * MIN, expiresAt: NOW + 10 * MIN })],
      questions: [question('q1', 'ui-designer', 'Which?', ['A', 'B'], { askedAt: NOW - MIN })],
    });
    const working = (ids: string[]) => update(update(update(update(c, ids[0] ?? '', { desk: desk('working') }), ids[1] ?? '', { desk: desk('working') }), ids[2] ?? '', { desk: desk('working') }), ids[3] ?? '', { desk: desk('working') });
    // The approval holds Kai's turn; the question ended Mina's, so her desk is idle and she was never counted.
    const four = working(['frontend-engineer', 'head-of-design', 'office-manager', 'head-of-engineering']);
    expect(heldCount(four, NOW)).toBe(1);
    expect(workingNow(four, NOW)).toBe(3);
    expect(companyState(stateOfCompany(four, NOW), NOW, clock).sentence).toBe('Three at work. One waits for you.');
    // An approval that ran out is no longer something you could answer.
    expect(heldCount({ ...four, approvals: [{ ...must(four.approvals, 0), expiresAt: NOW - MIN }] }, NOW)).toBe(0);
  });

  it("doesn't count the office's start? before someone's next task as holding them: they work on meanwhile", () => {
    const gate = question('q1', THE_OFFICE, 'Kai would like to start t-2, “Receipt screen”. Start it?', ['Start it', 'Not now'], { askedAt: NOW - MIN, taskId: 't-2', gate: { task: 't-2' } });
    const c = update(company({ desks: { working: 1, waiting: 0, max: 8 }, tasks: [task('t-2', 'frontend-engineer', 'Receipt screen')], questions: [gate] }), 'frontend-engineer', { desk: desk('working') });
    expect(heldCount(c, NOW)).toBe(0);
    expect(workingNow(c, NOW)).toBe(1);
    expect(companyState(stateOfCompany(c, NOW), NOW, clock).sentence).toBe('One at work.');
    // A gate question in the owner's own name, as the demo once sent it, holds nobody either.
    expect(heldCount({ ...c, questions: [{ ...gate, from: 'frontend-engineer' }] }, NOW)).toBe(0);
    // Their own question still does.
    expect(heldCount({ ...c, questions: [{ ...gate, from: 'frontend-engineer', gate: null }] }, NOW)).toBe(1);
  });

  it('says Waiting for you, not Idle, when the only people on desks are waiting on you', () => {
    expect(companyState({ ...base, held: 2 }, NOW, clock)).toEqual({ pill: 'Waiting for you', tone: 'needs', sentence: 'Nobody is at work. Two wait for you.' });
    expect(companyState({ ...base, held: 1, waiting: 1 }, NOW, clock).sentence).toBe('Nobody is at work. One waits for you. One waits for a desk.');
  });

  it('says Done, not Idle, once every task and milestone is done and nobody works (v0.2)', () => {
    expect(companyState({ ...base, done: true, lastReport: { who: 'Lou', at: NOW - 50 * MIN } }, NOW, clock)).toEqual({ pill: 'Done', tone: 'done', sentence: 'Every task and milestone is done. Last report 50 min ago from Lou.' });
    // A follow-up at work after the end reads as work, and a lobby entry is done by its summary's stage.
    expect(companyState({ ...base, done: true, working: 1 }, NOW, clock).pill).toBe('Working');
    const entry = demoLobby(NOW).companies.find((c) => c.id === 'rhine-swim');
    if (!entry) throw new Error('expected Rhine Swim in the demo lobby');
    expect(companyState(stateOfEntry(entry), NOW, clock).pill).toBe('Done');
  });

  it('says a rest or a failed draft before drafting, and drafts only while the CEO really drafts', () => {
    const until = Date.UTC(2026, 10, 5, 14, 53);
    const rest = { reason: 'usage-limit', since: NOW, until, message: '' } as const;
    expect(companyState({ ...base, phase: 'founding', pause: rest }, NOW, clock)).toMatchObject({ pill: 'Resting until 14:53', tone: 'rest' });
    expect(companyState({ ...base, phase: 'founding', draftFailed: true }, NOW, clock)).toEqual({ pill: "Couldn't draft", tone: 'error', sentence: "The CEO couldn't draft your company. Try again." });
    expect(companyState({ ...base, phase: 'founding' }, NOW, clock).pill).toBe('Drafting the org');
    // Before the draft, the CEO's scoping questions wait for you.
    expect(companyState({ ...base, phase: 'founding', scoping: true }, NOW, clock)).toEqual({ pill: 'Questions for you', tone: 'needs', sentence: 'The CEO has a few questions before drafting your company.' });
    // A rest wins over a failed draft: the usage limit is why it failed, and it lifts by itself.
    expect(companyState({ ...base, phase: 'founding', pause: rest, draftFailed: true }, NOW, clock).pill).toBe('Resting until 14:53');
    // And a problem with the folder wins over everything.
    expect(companyState({ ...base, phase: 'founding', draftFailed: true, problem: 'Folder gone.' }, NOW, clock).pill).toBe("Can't run");
  });

  it('says a CEO that stopped or ended its turn without a proposal is not drafting', () => {
    expect(companyState({ ...base, phase: 'founding', draftIdle: 'stopped' }, NOW, clock)).toMatchObject({ pill: 'Draft stopped', tone: 'neutral' });
    expect(companyState({ ...base, phase: 'founding', draftIdle: 'ended' }, NOW, clock)).toMatchObject({ pill: 'Waiting for you', tone: 'needs' });
    const ceo = person('ceo', 'Noor', 'CEO', 'direction', { level: 'ceo', desk: desk('idle') });
    const idle = company({ phase: 'founding', people: [ceo] });
    // The office's own word that the CEO's last turn ended without a proposal.
    const ended = { ...idle, drafting: { refused: 0, firstRefusal: null, stopped: { at: NOW, words: 'On it' } } };
    expect(companyState(stateOfCompany(ended, NOW), NOW, clock).pill).toBe('Waiting for you');
    // You stopped it: the top bar no longer says it drafts.
    const stopped = { ...idle, log: [{ at: NOW, kind: 'stop' as const, by: STAKEHOLDER, text: 'You stopped the CEO.' }] };
    expect(companyState(stateOfCompany(stopped, NOW), NOW, clock).pill).toBe('Draft stopped');
    // While the CEO works it drafts, whatever was left over.
    const working = { ...ended, people: [{ ...ceo, desk: desk('working') }] };
    expect(companyState(stateOfCompany(working, NOW), NOW, clock).pill).toBe('Drafting the org');
  });

  it('reads the CEO desk as a failed draft in the company view and in a lobby entry', () => {
    const founding = company({ phase: 'founding', people: [person('ceo', 'Noor', 'CEO', 'direction', { level: 'ceo', desk: desk('failed') })] });
    expect(companyState(stateOfCompany(founding, NOW), NOW, clock).pill).toBe("Couldn't draft");
    const entry = { ...demoLobby(NOW).companies[0], phase: 'founding', pause: null, problem: null, people: [{ id: 'ceo', room: 'direction', state: 'failed', look: {} }] } as LobbyCompany;
    expect(companyState(stateOfEntry(entry), NOW, clock).pill).toBe("Couldn't draft");
    const drafting = { ...entry, needsYou: 0, people: [{ id: 'ceo', room: 'direction', state: 'working', look: {} }] } as LobbyCompany;
    expect(companyState(stateOfEntry(drafting), NOW, clock).pill).toBe('Drafting the org');
    // Before the org, what needs you in a lobby entry is the CEO's scoping questions.
    expect(companyState(stateOfEntry({ ...drafting, needsYou: 4 }), NOW, clock).pill).toBe('Questions for you');
  });

  it('names people as the panels do after the first mention', () => {
    expect(shortName({ name: 'Mara', title: 'CEO', level: 'ceo' })).toBe('the CEO');
    expect(shortName({ name: 'Kai', title: 'Frontend engineer', level: 'worker' })).toBe('Kai');
    expect(shortName({ name: 'QA engineer', title: 'QA engineer', level: 'worker' })).toBe('the QA engineer');
    expect(shortName({ name: 'Head of design', title: 'Head of design', level: 'head' })).toBe('the head of design');
  });
});

describe("the inbox's state callout", () => {
  it('shows for a company that cannot run, rests or stopped, so the phone head says the state only there', () => {
    expect(showsStateCallout({ phase: 'running', pause: null, problem: "Its folder isn't at /old any more." })).toBe(true);
    expect(showsStateCallout({ phase: 'running', pause: { reason: 'stakeholder', since: NOW, until: null, message: '' }, problem: null })).toBe(true);
    expect(showsStateCallout({ phase: 'stopped', pause: null, problem: null })).toBe(true);
  });

  it('stays away while the company is running well or still being founded', () => {
    expect(showsStateCallout({ phase: 'running', pause: null, problem: null })).toBe(false);
    expect(showsStateCallout({ phase: 'founding', pause: null, problem: 'x' })).toBe(false);
    expect(showsStateCallout({ phase: 'proposed', pause: null, problem: null })).toBe(false);
  });
});

describe('the lobby', () => {
  const lobby = demoLobby(NOW);

  it('cuts a folder in the middle so its start and its name show', () => {
    expect(cutMiddle('C:\\Users\\jamie\\Desktop\\Development\\plant-pal', 28)).toBe('C:\\Users\\…\\plant-pal');
    expect(cutMiddle('/home/you/projects/work/plant-pal', 24)).toBe('/home/…/plant-pal');
    expect(cutMiddle('C:\\plant-pal')).toBe('C:\\plant-pal');
  });

  it('counts desks across companies in words', () => {
    expect(desksLine({ maxDesks: 8, working: 6 })).toBe('Six of eight desks in use across companies.');
    expect(desksLine(lobby.hub)).toBe('Nine of twelve desks in use across companies.');
  });

  it('writes a row per company: state, latest status line, what needs you, what it spent', () => {
    const cafe = lobby.companies.find((c) => c.id === 'demo');
    expect(cafe).toBeDefined();
    if (!cafe) return;
    const row = lobbyRow(cafe, NOW, clock);
    expect(row).toMatchObject({ name: 'Café Lumen', needsYou: 6, spent: '$40.27 spent', folder: 'C:\\Users\\you\\Projects\\cafe-lumen' });
    expect(row.state.sentence).toBe('Eight at work. One waits for a desk.');
    expect(row.latest).toBe('Yara: Starting the payment data review.');
    const broken = lobby.companies.find((c) => c.id === 'old-site');
    expect(broken && lobbyRow(broken, NOW, clock).state).toMatchObject({ pill: "Can't run", tone: 'error' });
  });

  it("says whose latest line it is by their first name, where the lobby entry has one", () => {
    const cafe = lobby.companies.find((c) => c.id === 'demo');
    if (!cafe) throw new Error('no café in the demo lobby');
    // The demo café's entry names its people as the real company's does.
    const line = { person: 'ux-designer', text: 'Finished the watering flow sketch.', taskId: null, at: NOW - 60_000 };
    expect(lobbyRow({ ...cafe, latest: line }, NOW, clock).latest).toBe('Jules: Finished the watering flow sketch.');
    expect(lobbyRow({ ...cafe, latest: { ...line, person: 'ceo' } }, NOW, clock).latest).toBe('Mara: Finished the watering flow sketch.');
    // An entry from before names came stays readable by the role's title.
    const unnamed = { ...cafe, people: cafe.people.map(({ id, room, state, look }) => ({ id, room, state, look })) };
    expect(lobbyRow({ ...unnamed, latest: line }, NOW, clock).latest).toBe('UX designer: Finished the watering flow sketch.');
    expect(lobbyRow({ ...unnamed, latest: { ...line, person: 'ceo' } }, NOW, clock).latest).toBe('The CEO: Finished the watering flow sketch.');
    // Someone the entry doesn't list (they left since) is named by their role's title too.
    expect(lobbyRow({ ...cafe, latest: { ...line, person: 'growth-marketer' } }, NOW, clock).latest).toBe('Growth marketer: Finished the watering flow sketch.');
  });

  it('adds up what needs you, here and elsewhere, for the titles and the Lobby link', () => {
    expect(totalNeeds(lobby)).toBe(14);
    expect(otherNeeds(lobby, 'demo')).toBe(8);
    expect(lobbyTitle(5)).toBe('(5) Worklings lobby');
    expect(lobbyTitle(0)).toBe('Worklings lobby');
    expect(companyTitle('Plant Pal', 3)).toBe('(3) Plant Pal in Worklings');
    expect(companyTitle('Plant Pal', 0)).toBe('Plant Pal in Worklings');
  });

  it('calls a usage limit on every running company a hub-wide problem', () => {
    const entry = (id: string, until: number | null): LobbyCompany => ({
      id, name: id, root: `C:\\${id}`, phase: 'running', theme: 'office', people: [], working: 0, waiting: 0, needsYou: 0, spend: 0, latest: null, problem: null,
      pause: { reason: 'usage-limit', since: NOW, until, message: '' },
    });
    const resting: LobbyView = { companies: [entry('a', Date.UTC(2026, 10, 5, 14, 0)), entry('b', Date.UTC(2026, 10, 5, 14, 0))], hub: { maxDesks: 8, working: 0 }, serverTime: NOW };
    expect(hubProblem(resting, clock)).toBe('Your Claude usage limit was reached. Every company rests until 14:00.');
    expect(hubProblem(lobby, clock)).toBeNull();
  });

  it('says a company in the lobby is starting while it hires and makes its branch', () => {
    const entry: LobbyCompany = {
      id: 'plant-pal', name: 'Plant Pal', root: 'C:\\plant-pal', phase: 'proposed', theme: 'office', people: [], working: 0, waiting: 0,
      needsYou: 1, spend: 0, latest: null, problem: null, pause: null, starting: true,
    };
    expect(companyState(stateOfEntry(entry), NOW, clock)).toMatchObject({ pill: 'Starting' });
    expect(companyState(stateOfEntry({ ...entry, starting: false }), NOW, clock)).toMatchObject({ pill: 'Proposal ready' });
  });

  it('says how things stood while reconnecting', () => {
    expect(reconnectingLine(Date.UTC(2026, 10, 5, 14, 32), clock)).toBe('Reconnecting to the office. This is how things stood at 14:32.');
  });
});

describe('the live region', () => {
  const cafe = demoCompanyView(NOW);

  it('says new questions and approvals, replies, the proposal arriving and rest falling and lifting', () => {
    const after: CompanyView = {
      ...cafe,
      approvals: [...cafe.approvals, { ...must(cafe.approvals, 2), id: 'a-9', summary: 'Push to GitHub.' }],
      questions: [...cafe.questions, { ...must(cafe.questions, 3), id: 'q-9' }],
      messages: [...cafe.messages, { ...must(cafe.messages, 0), id: 'm-99', from: 'ceo', to: '@stakeholder' }],
      pause: { reason: 'usage-limit', since: NOW, until: Date.UTC(2026, 10, 5, 14, 0), message: '' },
    };
    expect(companyNews(cafe, after, clock)).toEqual(['Kai needs your OK to push to GitHub.', 'The CEO has a question for you.', 'The CEO replied to you.', 'Café Lumen is resting until 14:00.']);
    expect(companyNews(after, { ...after, pause: null }, clock)).toEqual(['Café Lumen is working again.']);
    const plant = demoProposalView(NOW);
    expect(companyNews({ ...plant, phase: 'founding', proposal: null }, plant, clock)).toContain("The CEO's proposal is ready.");
  });

  it('says the company started when the proposal turns into a running company', () => {
    const plant = demoProposalView(NOW);
    expect(companyNews(plant, { ...plant, phase: 'running' }, clock)).toEqual(['Plant Pal started. Everyone is hired.']);
  });

  it('stays quiet when nothing new needs you, and when you paused it yourself', () => {
    expect(companyNews(cafe, cafe, clock)).toEqual([]);
    expect(companyNews(cafe, { ...cafe, pause: { reason: 'stakeholder', since: NOW, until: null, message: '' } }, clock)).toEqual([]);
  });

  it("names another company's news by the company", () => {
    const before = demoLobby(NOW);
    const after: LobbyView = { ...before, companies: before.companies.map((c) => (c.id === 'plant-pal' ? { ...c, needsYou: c.needsYou + 2 } : c)) };
    expect(lobbyNews(before, after, 'demo')).toEqual(['Plant Pal: two more things need you.']);
    expect(lobbyNews(before, after, 'plant-pal')).toEqual([]);
  });

  it('says several things at once as one sentence', () => {
    expect(oneSentence(['Kai needs your OK to push to GitHub.'])).toBe('Kai needs your OK to push to GitHub.');
    expect(oneSentence(['Kai needs your OK.', 'The CEO has a question for you.'])).toBe('Kai needs your OK, and the CEO has a question for you.');
    expect(oneSentence(['A.', 'B.', 'C.'])).toBe('A, B, and C.');
    expect(oneSentence([])).toBe('');
  });
});

describe('a conversation', () => {
  const asked: Question = {
    id: 'q-1', from: 'ceo', text: 'Should a streak forgive one missed day a week?', options: ['Forgive one day a week.', 'Never forgive'], recommended: 0,
    taskId: null, askedAt: NOW, answer: { option: 0, text: '', at: NOW, appliesAt: NOW + 5000 }, withdrawn: null,
  };
  const relayed = { text: 'on "Should a streak forgive one missed day a week?": Forgive one day a week.', answers: 'q-1' };

  // Worded as the person panel words it (answerSentence), so an answer reads the same in every conversation.
  it('shows your answer as an answer to its question, not in the words the asker gets', () => {
    expect(shownText(relayed, [asked])).toBe('You answered “Should a streak forgive one missed day a week?”: Forgive one day a week.');
    const both = { ...asked, answer: { option: 1, text: 'Streaks are the point', at: NOW, appliesAt: NOW } };
    expect(shownText(relayed, [both])).toBe('You answered “Should a streak forgive one missed day a week?”: Never forgive. Streaks are the point.');
  });

  it('leaves other messages as they were written, and reads an answer whose question is gone from its words', () => {
    expect(shownText({ text: 'merge design and UX', answers: null }, [asked])).toBe('merge design and UX');
    expect(shownText(relayed, [])).toBe('You answered “Should a streak forgive one missed day a week?”: Forgive one day a week.');
  });
});

describe("the ledger's money", () => {
  const cafe = demoCompanyView(NOW);
  const office = (cost: number) => {
    const aside = emptyAsideView(NOW);
    return { ...aside, spend: { ...aside.spend, cost } };
  };

  it("adds up the company's people and the office's own Ask aside and Catch me up calls", () => {
    const people = cafe.people.reduce((sum, p) => sum + p.cost, 0);
    expect(people).toBeGreaterThan(0);
    expect(companySpend(cafe, office(0.12))).toBeCloseTo(people + 0.12, 10);
  });

  it("keeps what people cost when the office restarts, where v2's totals would start again at $0", () => {
    const ceo = cafe.people.find((p) => p.level === 'ceo');
    expect(ceo).toBeDefined();
    if (!ceo) return;
    // A fresh office has seen no transcripts yet; the company still knows the CEO cost $1.15.
    expect(companySpend({ people: [{ ...ceo, cost: 1.15 }], spend: { byPerson: [] } }, office(0))).toBe(1.15);
  });

  it('keeps what a fired person cost: firing never lowers the money spent', () => {
    const kai = cafe.people.find((p) => p.level !== 'ceo' && p.cost > 0);
    expect(kai).toBeDefined();
    if (!kai) return;
    const before = companySpend({ people: cafe.people, spend: { byPerson: [] } }, office(0));
    const after = companySpend({ people: cafe.people.filter((p) => p.id !== kai.id), spend: { byPerson: [{ person: kai.id, today: 0, week: 0, all: kai.cost }] } }, office(0));
    expect(after).toBeCloseTo(before, 10);
  });

  it('says Spend on an API key and API-equivalent on a plan, as the Spend dashboard does', () => {
    expect(spendWords('api-key', '5 Nov 2026')).toEqual({ label: 'Spend', title: 'What Claude Code reported for your API key.' });
    expect(spendWords('plan', '5 Nov 2026')).toEqual({ label: 'API-equivalent', title: 'What the same tokens would cost on the Claude API, at list prices of 5 Nov 2026.' });
  });
});
