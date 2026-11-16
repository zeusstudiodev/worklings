import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { type CompanyView, type Message, STAKEHOLDER } from '../src/core/company.ts';
import { DEMO_SCOPING, demoCompanyView, demoFoundingView, demoProposal, demoProposalView, demoScoping, demoSmallProposal } from '../src/core/demo-company.ts';
import { checkProposal, type OrgProposal, type ProposedPerson } from '../src/core/org.ts';
import { lintNewRole } from '../src/org/agents.ts';
import {
  addPerson,
  addRoom,
  answerOf,
  answerText,
  chartOf,
  checkDraft,
  defaultManager,
  ceoLabel,
  draftState,
  editPerson,
  fieldCount,
  freeId,
  libraryProblem,
  managerChoices,
  notSavedLine,
  officeSentence,
  ownsOf,
  reasonsOf,
  modelsSentence,
  newRolesSentence,
  openQuestionsNote,
  outlineOf,
  peopleSentence,
  proposalAnswer,
  questionRecord,
  picksNote,
  removePerson,
  scopingAnswers,
  scopingLine,
  scopingOf,
  type ScopingState,
  scopingWaits,
  showsSuggestions,
  sizeNote,
  sizingSentence,
  themeSentence,
  whyLine,
} from '../web/src/company/proposal/model.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);

/** The café as the CEO would have proposed it: its 18 people, two roles written for it. */
function cafeProposal(): OrgProposal {
  const cafe = demoCompanyView(NOW);
  const written = new Set(['twint-payments-engineer', 'local-seo-specialist']);
  return {
    company: cafe.name,
    goal: cafe.goal?.text ?? '',
    theme: cafe.theme,
    rooms: [
      { id: 'direction', title: 'Direction', style: 'direction' },
      { id: 'design', title: 'Design', style: 'design' },
      { id: 'engineering', title: 'Engineering', style: 'engineering' },
      { id: 'content', title: 'Content', style: 'content' },
      { id: 'quality', title: 'Quality', style: 'quality' },
    ],
    people: cafe.people.map((p): ProposedPerson => ({
      id: p.id, name: p.name, title: p.title, level: p.level, room: p.room, reportsTo: p.reportsTo, model: p.model === 'opus' || p.model === 'haiku' ? p.model : 'sonnet',
      owns: `${p.title}'s area.`,
      ...(written.has(p.id) ? { role: { description: 'Written for the café.', body: '## Mission' } } : { library: p.id }),
    })),
    questions: [],
  };
}

describe("the proposal's summary", () => {
  it('counts people, rooms and levels in words, the CEO included', () => {
    expect(peopleSentence(cafeProposal())).toBe('18 people in five rooms: the CEO, three heads, a team lead and 13 workers.');
    expect(peopleSentence(demoProposal())).toBe('15 people in five rooms: the CEO, two heads and twelve workers.');
  });

  it('says the models, the theme and the roles written for this company', () => {
    expect(modelsSentence(cafeProposal())).toBe('Models: two on Opus, 13 on Sonnet, three on Haiku.');
    expect(themeSentence(cafeProposal())).toBe('Theme: café.');
    expect(newRolesSentence(cafeProposal())).toBe('Written for this company: TWINT payments engineer and local SEO specialist.');
    expect(newRolesSentence({ people: cafeProposal().people.filter((p) => p.role === undefined) })).toBeNull();
  });

  it('notes a size outside 2 to 25 without blocking anything', () => {
    expect(sizeNote(cafeProposal())).toBeNull();
    // A small org is the CEO's call now; only the CEO alone, who builds nothing, gets a note.
    expect(sizeNote({ people: cafeProposal().people.slice(0, 2) })).toBeNull();
    expect(sizeNote({ people: cafeProposal().people.slice(0, 1) })).toBe("That's only the CEO, who doesn't build anything: add someone to do the work.");
  });
});

describe('the check that blocks Start', () => {
  it('passes the CEO proposals the demo carries', () => {
    expect(checkDraft(demoProposal())).toEqual([]);
    expect(checkDraft(cafeProposal())).toEqual([]);
  });

  it("gives the demo a proposal the org's own check and the library linter accept", () => {
    const library = loadLibrary(resolve('library'));
    const libraryRoles = new Set(readdirSync(resolve('library', 'roles')).map((f) => f.replace(/\.md$/, '')));
    // Plant Pal is a Thorough company: its two checker seats are what Balanced doesn't allow.
    const check = checkProposal(demoProposal(), { libraryRoles, lintRole: (draft) => lintNewRole(library, draft), preset: 'thorough' });
    expect(check.ok ? [] : check.errors).toEqual([]);
  });

  it('asks for a team lead in a room over six people, with the fix', () => {
    const p = demoProposal();
    const { proposal } = addPerson(p, { room: 'design', name: 'Nora', title: 'UX designer', model: 'sonnet', owns: 'Flows.', library: 'ux-designer' });
    expect(checkDraft(proposal)).toEqual(['Design has seven people and no team lead. Add one, move someone, or ask the CEO.']);
  });

  it('refuses a manager who manages nobody, a missing manager and a missing room', () => {
    const p = demoProposal();
    const underWorker = editPerson(p, 'ux-designer', { name: 'Ivy', title: 'UX designer', room: 'design', reportsTo: 'ui-designer', model: 'sonnet', owns: 'Flows.' });
    expect(checkDraft(underWorker)).toContain('Ivy reports to Leo, who manages nobody. Pick a head or a team lead.');
    const orphan = { ...p, people: p.people.map((x) => (x.id === 'qa-engineer' ? { ...x, reportsTo: 'nobody' } : x)) };
    expect(checkDraft(orphan)).toContain('Joy reports to nobody in the proposal. Pick their manager.');
    const lost = { ...p, people: p.people.map((x) => (x.id === 'qa-engineer' ? { ...x, room: 'kitchen' } : x)) };
    expect(checkDraft(lost)).toContain("Joy is in a room the proposal doesn't have. Pick one of its rooms.");
  });

  it("keeps heads under the CEO and team leads under a head, as the org's rules do", () => {
    const p = demoProposal();
    const underHead = { ...p, people: p.people.map((x) => (x.id === 'head-of-design' ? { ...x, reportsTo: 'head-of-engineering' } : x)) };
    expect(checkDraft(underHead)).toEqual(['Rosa is a head, so they report to the CEO.']);
  });

  it('asks for someone in a room that was added empty', () => {
    const { proposal } = addRoom(demoProposal(), { title: 'Growth', style: 'content' });
    expect(checkDraft(proposal)).toEqual(['Growth has nobody in it yet. Add someone, or undo adding the room.']);
  });

  it('wants one CEO and a first name for everyone', () => {
    const p = demoProposal();
    expect(checkDraft({ ...p, people: p.people.filter((x) => x.level !== 'ceo') })).toContain('The proposal needs a CEO.');
    const nameless = editPerson(p, 'art-director', { name: '', title: 'Art director', room: 'design', reportsTo: 'head-of-design', model: 'haiku', owns: 'Drawings.' });
    expect(checkDraft(nameless)).toContain('Someone in Design needs a first name: letters, up to 40.');
  });

  it("holds titles and areas to the office's own limits, 60 and 200 characters", () => {
    const p = demoProposal();
    const long = editPerson(p, 'ux-designer', { name: 'Ivy', title: 'UI designer and illustrator for plant portraits and the streak card', room: 'design', reportsTo: 'head-of-design', model: 'sonnet', owns: 'x'.repeat(201) });
    expect(checkDraft(long)).toEqual(["Ivy's title is 67 characters; the most is 60.", 'What Ivy owns is 201 characters; the most is 200.']);
    const fits = editPerson(p, 'ux-designer', { name: 'Ivy', title: 'x'.repeat(60), room: 'design', reportsTo: 'head-of-design', model: 'sonnet', owns: 'x'.repeat(200) });
    expect(checkDraft(fits)).toEqual([]);
    const silent = editPerson(p, 'ux-designer', { name: 'Ivy', title: 'UX designer', room: 'design', reportsTo: 'head-of-design', model: 'sonnet', owns: '  ' });
    expect(checkDraft(silent)).toEqual(['Say what Ivy owns.']);
  });
});

describe("the office's reasons", () => {
  const p = demoProposal();
  const at = (id: string) => p.people.findIndex((x) => x.id === id);
  const ux = p.people[at('ux-designer')];

  it('names the person a reason is about, as the panel says its own', () => {
    if (!ux) throw new Error('no UX designer');
    const i = at('ux-designer');
    expect(officeSentence(`people[${i}].title: up to 60 characters, got 67`, p)).toBe(`${ux.name}'s title is 67 characters; the most is 60.`);
    expect(officeSentence(`people[${i}].owns: up to 200 characters, got 230`, p)).toBe(`What ${ux.name} owns is 230 characters; the most is 200.`);
    expect(officeSentence(`people[${i}].title: expected their title as text, got ""`, p)).toBe(`${ux.name} needs a title.`);
    expect(officeSentence(`people[${i}].owns: expected one sentence on what they own as text, got ""`, p)).toBe(`Say what ${ux.name} owns.`);
    expect(officeSentence(`people[${i}].name: expected a first name of letters, up to 40 characters, got "K4i"`, p)).toBe(`${ux.name} needs a first name: letters, up to 40.`);
    expect(officeSentence(`people[${i}].title: "@notes.md" would have Claude Code load a file`, p)).toBe(`${ux.name}'s title: "@notes.md" would have Claude Code load a file.`);
    expect(officeSentence(`people[${i}]: give library or role, not both`, p)).toBe(`${ux.name}: give library or role, not both.`);
  });

  it('names the room for a room, and keeps a reason that names nobody in the office words', () => {
    expect(officeSentence('rooms[1].title: up to 40 characters, got 45', p)).toBe(`The name of ${p.rooms[1]?.title} is 45 characters; the most is 40.`);
    expect(officeSentence('people: expected 1 to 60 people, got 61', p)).toBe('People: expected 1 to 60 people, got 61.');
    expect(officeSentence('people[99].title: up to 60 characters, got 61', p)).toBe("Someone's title is 61 characters; the most is 60.");
  });

  it("gives the panel's own words where it knows the rule, else the office's, each once", () => {
    const i = at('ux-designer');
    const long = editPerson(p, 'ux-designer', { name: 'Ivy', title: 'x'.repeat(67), room: 'design', reportsTo: 'head-of-design', model: 'sonnet', owns: 'Flows.' });
    expect(reasonsOf(long, [`people[${i}].title: up to 60 characters, got 67`])).toEqual(["Ivy's title is 67 characters; the most is 60."]);
    const fine = reasonsOf(p, [`people[${i}].library: "ux-wizard" is not a library role`, `people[${i}].library: "ux-wizard" is not a library role`]);
    expect(fine).toEqual([`${ux?.name}'s library role: "ux-wizard" is not a library role.`]);
  });

  it('says an edit the office turned down is not saved, with the first reason', () => {
    expect(notSavedLine(["Kai's title is 67 characters; the most is 60.", 'Say what Kai owns.'])).toBe("Not saved. Kai's title is 67 characters; the most is 60.");
    expect(notSavedLine([])).toBe('Not saved. The office turned it down.');
  });
});

describe('a library role added to the proposal', () => {
  it("owns its description's first sentence, cut to what the office takes", () => {
    expect(ownsOf('Designs flows and screens. Use for onboarding.')).toBe('Designs flows and screens.');
    const long = `Designs the core loop, ${'mechanics, rules and progression, '.repeat(8)}with every tunable number kept in data. Covers web games.`;
    const owns = ownsOf(long);
    expect(owns.length).toBeLessThanOrEqual(200);
    expect(owns.endsWith('…')).toBe(true);
    expect(owns.startsWith('Designs the core loop, mechanics')).toBe(true);
    expect(ownsOf('  Reviews  diffs\nfor risk  ')).toBe('Reviews diffs for risk');
  });
});

describe("a field the office limits", () => {
  it('counts from three quarters full', () => {
    expect(fieldCount('x'.repeat(44), 60)).toBeNull();
    expect(fieldCount('x'.repeat(45), 60)).toBe('45 of 60');
    expect(fieldCount('x'.repeat(60), 60)).toBe('60 of 60');
  });
});

describe('the chart', () => {
  it('puts you, the CEO and the office manager on top and a column per room, heads first', () => {
    const chart = chartOf(demoProposal());
    expect(chart.top.map((c) => c.person.id)).toEqual(['ceo', 'office-manager']);
    expect(chart.columns.map((c) => c.room.title)).toEqual(['Design', 'Engineering', 'Plant care', 'Quality']);
    const design = chart.columns[0]?.cards.map((c) => c.person.level);
    expect(design?.[0]).toBe('head');
    expect(chart.removed).toEqual([]);
  });

  it('tags roles written for the company, and what a revision added, changed or took out', () => {
    const before = demoProposal();
    expect(chartOf(before).columns.flatMap((c) => c.cards).filter((c) => c.tag === 'New role').map((c) => c.person.id)).toEqual(['push-notification-engineer', 'plant-care-expert']);
    const moved = editPerson(before, 'qa-engineer', { name: 'Joy', title: 'QA engineer', room: 'engineering', reportsTo: 'head-of-engineering', model: 'sonnet', owns: 'Tests.' });
    const added = addPerson(removePerson(moved, 'art-director'), { room: 'design', name: 'Nora', title: 'Copywriter', model: 'haiku', owns: 'Words.', library: 'copywriter' }).proposal;
    const chart = chartOf(added, before);
    const tag = (id: string) => chart.columns.flatMap((c) => c.cards).find((c) => c.person.id === id)?.tag;
    expect(tag('qa-engineer')).toBe('Changed: moved from Quality');
    expect(tag('copywriter')).toBe('Added');
    expect(chart.removed.map((x) => x.id)).toEqual(['art-director']);
  });

  it('draws the same org as an outline on phones, each person under their manager', () => {
    const outline = outlineOf(demoProposal());
    expect(outline[0]).toMatchObject({ person: { id: 'ceo' }, depth: 0 });
    const depthOf = (id: string) => outline.find((o) => o.person.id === id)?.depth;
    expect(depthOf('head-of-design')).toBe(1);
    expect(depthOf('ui-designer')).toBe(2);
    expect(outline).toHaveLength(demoProposal().people.length);
  });
});

describe('direct edits', () => {
  it('hands the reports of someone taken out to their manager', () => {
    const p = removePerson(demoProposal(), 'head-of-design');
    expect(p.people.find((x) => x.id === 'ui-designer')?.reportsTo).toBe('ceo');
    expect(p.people.some((x) => x.id === 'head-of-design')).toBe(false);
  });

  it('gives a newcomer a free id and the room team lead or head as manager', () => {
    const p = demoProposal();
    expect(freeId(p, 'ui-designer')).toBe('ui-designer-2');
    expect(freeId(p, 'Swiss privacy specialist')).toBe('swiss-privacy-specialist');
    expect(defaultManager(p, 'design')).toBe('head-of-design');
    expect(defaultManager(p, 'plant-care')).toBe('ceo');
    const { proposal, id } = addRoom(p, { title: 'Growth', style: 'content' });
    expect(id).toBe('growth');
    expect(proposal.rooms.at(-1)).toEqual({ id: 'growth', title: 'Growth', style: 'content' });
  });

  it('offers as managers only those the person may report to, never someone under them', () => {
    expect(managerChoices(demoProposal(), 'head-of-design').map((x) => x.id)).toEqual(['ceo']);
    expect(managerChoices(demoProposal(), 'ui-designer').map((x) => x.id)).toEqual(['ceo', 'head-of-design', 'head-of-engineering']);
  });

  it("says the library couldn't be read in the office's own words, leaving Try again to its button", () => {
    expect(libraryProblem("The office didn't answer. Try again.")).toBe("Couldn't read the library. The office didn't answer.");
    expect(libraryProblem("That company isn't in the lobby any more.")).toBe("Couldn't read the library. That company isn't in the lobby any more.");
    expect(libraryProblem('The office answered 502')).toBe("Couldn't read the library. The office answered 502.");
    expect(libraryProblem(' ')).toBe("Couldn't read the library. The office didn't answer.");
  });
});

describe("the CEO's questions and the draft's state", () => {
  it('knows an answer from the message it sent the CEO', () => {
    const q = { text: 'iPhone first?', options: ['Yes', 'No'], recommended: 0 };
    const sent: Message = { id: 'm1', from: STAKEHOLDER, to: 'ceo', text: answerText(q, 'Yes'), origin: null, relayOf: null, note: null, at: NOW, deliveredAt: null, interrupt: false };
    expect(answerText(q, 'Yes')).toBe('About “iPhone first?”: Yes');
    expect(answerOf(q, [sent], 'ceo', NOW - 1)).toBe('Yes');
    expect(answerOf(q, [sent], 'ceo', NOW + 1)).toBeNull();
    expect(openQuestionsNote(2)).toBe("Two questions are open. Starting uses the CEO's picks for them.");
    expect(openQuestionsNote(1)).toBe("One question is open. Starting uses the CEO's pick for it.");
    expect(openQuestionsNote(0)).toBeNull();
  });

  it("answers the proposal's questions through the inbox's, as the hub asks them", () => {
    const plant = demoProposalView(NOW);
    const q = plant.proposal?.questions[0];
    if (!q) throw new Error('no question');
    const record = questionRecord(q, plant.questions, 'ceo');
    if (!record) throw new Error('no inbox question for it');
    expect(record.id).toBe('plant-pal-q1');
    expect(proposalAnswer(q, record, plant.messages, 'ceo', 0)).toBeNull();
    // The hub keeps a pressed option as its index, with no words: the option's own words are the answer.
    const answered = { ...record, answer: { option: 0, text: '', at: NOW, appliesAt: NOW + 5_000 } };
    expect(proposalAnswer(q, answered, [], 'ceo', 0)).toEqual({ text: 'Forgive one day a week', appliesAt: NOW + 5_000 });
    // A revision withdraws the question; the next one asked with the same words is the one that counts.
    const withdrawn = { ...answered, withdrawn: { reason: 'The CEO revised the proposal.', at: NOW } };
    expect(questionRecord(q, [withdrawn], 'ceo')).toBeNull();
  });

  it('tells drafting, failed, stopped, fixing and ready apart', () => {
    const drafting = demoFoundingView(NOW);
    expect(draftState(drafting)).toBe('drafting');
    const ceo = drafting.people[0];
    if (!ceo) throw new Error('no CEO');
    const withDesk = (state: CompanyView['people'][number]['desk']['state']): CompanyView => ({ ...drafting, people: [{ ...ceo, desk: { ...ceo.desk, state, problem: 'Claude Code stopped with an error.' } }] });
    expect(draftState(withDesk('failed'))).toBe('failed');
    const stopped = { ...withDesk('idle'), log: [...drafting.log, { at: NOW, kind: 'stop' as const, by: STAKEHOLDER, text: 'You stopped the CEO.' }] };
    expect(draftState(stopped)).toBe('stopped');
    expect(draftState(drafting, { attempts: 1, error: 'Two rooms had the same name.' })).toBe('fixing');
    expect(draftState(drafting, { attempts: 3, error: 'Two rooms had the same name.' })).toBe('gave-up');
    expect(draftState(demoProposalView(NOW))).toBe('ready');
  });

  it('names a CEO whose name is its title as "the CEO", and offers change chips only once there is a proposal', () => {
    expect(ceoLabel({ name: 'CEO', title: 'CEO' })).toBe('the CEO');
    expect(ceoLabel({ name: 'Juno', title: 'CEO' })).toBe('Juno');
    expect(showsSuggestions(demoFoundingView(NOW))).toBe(false);
    // With a proposal on show the chips offer changes to it.
    expect(showsSuggestions(demoProposalView(NOW))).toBe(true);
  });

  it("tells a CEO whose turn ended without a proposal from one that drafts or that you stopped", () => {
    const drafting = demoFoundingView(NOW);
    const ceo = drafting.people[0];
    if (!ceo) throw new Error('no CEO');
    const withDesk = (state: CompanyView['people'][number]['desk']['state']): CompanyView => ({ ...drafting, people: [{ ...ceo, desk: { ...ceo.desk, state } }] });
    const ended = { refused: 0, firstRefusal: null, stopped: { at: NOW, words: 'On it' } };
    expect(draftState({ ...withDesk('idle'), drafting: ended })).toBe('ended');
    // Words or none, it is the same state; the office nulls it while the CEO drafts and once a message reaches it.
    expect(draftState({ ...withDesk('idle'), drafting: { ...ended, stopped: { at: NOW, words: '' } } })).toBe('ended');
    expect(draftState({ ...withDesk('idle'), drafting: { ...ended, stopped: null } })).toBe('drafting');
    expect(draftState({ ...withDesk('working'), drafting: ended })).toBe('drafting');
    // Your own Stop and a failed desk still say so first.
    const stop = { at: NOW, kind: 'stop' as const, by: STAKEHOLDER, text: 'You stopped the CEO.' };
    expect(draftState({ ...withDesk('idle'), drafting: ended, log: [...drafting.log, stop] })).toBe('stopped');
    expect(draftState({ ...withDesk('failed'), drafting: ended })).toBe('failed');
    // A proposal that stands is ready, whatever the CEO ended with.
    expect(draftState({ ...demoProposalView(NOW), drafting: ended })).toBe('ready');
  });
});

describe("the CEO's scoping questions, before the org", () => {
  /** A founding company whose CEO has just asked the demo's four scoping questions. */
  const asking = (): CompanyView => {
    const view = demoFoundingView(NOW);
    const round = demoScoping('lake-wind', DEMO_SCOPING, NOW - 60_000, null);
    return { ...view, questions: round.questions, scoping: round.scoping, log: view.log.filter((e) => e.kind === 'founded') };
  };
  const answer = (view: CompanyView, id: string, option: number | null, text = ''): CompanyView => ({
    ...view,
    questions: view.questions.map((q) => (q.id === id ? { ...q, answer: { option, text, at: NOW, appliesAt: NOW + 5_000 } } : q)),
  });

  it('is the first state while they wait, with every question in the order asked', () => {
    const view = asking();
    expect(draftState(view)).toBe('scoping');
    // The CEO asked its questions and ended its turn without a proposal: still "A few questions first".
    expect(draftState({ ...view, drafting: { refused: 0, firstRefusal: null, stopped: { at: NOW, words: 'Four questions for you.' } } })).toBe('scoping');
    const s = scopingOf(view);
    expect(s?.items.map((i) => [i.question.text, i.answer])).toEqual(DEMO_SCOPING.map((q) => [q.text, null]));
    expect(s?.open).toBe(4);
    expect(scopingWaits(s)).toBe(true);
    expect(scopingLine(s as ScopingState, 'Rhea')).toBe("Rhea has four questions before drafting your company. Answer each, or use the CEO's picks.");
    expect(picksNote(4)).toBe('Answers the four open questions with the pick marked on each.');
    expect(picksNote(1)).toBe('Answers the open question with the pick marked on it.');
    // A failed desk still says so first.
    const ceo = view.people[0];
    if (!ceo) throw new Error('no CEO');
    expect(draftState({ ...view, people: [{ ...ceo, desk: { ...ceo.desk, state: 'failed' } }] })).toBe('failed');
  });

  it('says how many are open as you answer, and what happens once all are', () => {
    let view = answer(asking(), 'lake-wind-s1', 2);
    view = answer(view, 'lake-wind-s2', null, 'Something I can show friends next week');
    const s = scopingOf(view) as ScopingState;
    expect(s.items.map((i) => i.answer && [i.answer.text, i.answer.own])).toEqual([['Anyone who finds it', false], ['Something I can show friends next week', true], null, null]);
    expect(scopingLine(s, 'Rhea')).toBe("Two of four still open. Answer them, or use the CEO's picks for the rest.");
    view = answer(answer(view, 'lake-wind-s3', 0), 'lake-wind-s4', 1);
    const all = scopingOf(view) as ScopingState;
    expect(all.open).toBe(0);
    // Still the scoping state until the office has sent them: Undo is open on each meanwhile.
    expect(draftState(view)).toBe('scoping');
    expect(scopingLine(all, 'Rhea')).toBe('Your answers reach the CEO in a few seconds, and it drafts your company from them.');
    expect(scopingAnswers(all)).toEqual([
      { question: 'Who is it for?', answer: 'Anyone who finds it' },
      { question: 'How far should the first version go?', answer: '“Something I can show friends next week”' },
      { question: 'Where should it run?', answer: 'On the web' },
      { question: 'What matters most?', answer: 'Polish and quality' },
    ]);
    // Once they went to the CEO, it drafts.
    const sent = { ...view, scoping: view.scoping ? { ...view.scoping, answeredAt: NOW + 5_000 } : null };
    expect(draftState(sent)).toBe('drafting');
    expect(scopingWaits(scopingOf(sent))).toBe(false);
  });

  it("shows the CEO's why under its pick, and leaves out questions taken back", () => {
    const view = asking();
    const first = view.questions[0];
    if (!first) throw new Error('no question');
    expect(whyLine(first)).toBe('Why the CEO picks “Anyone who finds it”: Most ideas like this are meant for other people to use.');
    expect(whyLine({ ...first, why: 'no stop at the end' })).toBe('Why the CEO picks “Anyone who finds it”: no stop at the end.');
    expect(whyLine({ ...first, why: null })).toBeNull();
    expect(whyLine({ ...first, recommended: null })).toBeNull();
    // The CEO drafted early or was stopped: the withdrawn ones go, and with all of them gone it no longer waits.
    const withdrawn = { ...view, questions: view.questions.map((q) => ({ ...q, withdrawn: { reason: 'You stopped the CEO.', at: NOW } })) };
    expect(scopingOf(withdrawn)?.items).toEqual([]);
    expect(draftState(withdrawn)).toBe('drafting');
    // A company whose CEO asked nothing has no round at all.
    expect(scopingOf({ scoping: null, questions: [] })).toBeNull();
  });

  it('shows in the demo honestly: Plant Pal was scoped before its proposal, Lake Wind drafts from its answers', () => {
    const plant = demoProposalView(NOW);
    expect(draftState(plant)).toBe('ready');
    expect(scopingAnswers(scopingOf(plant))).toEqual([
      { question: 'Who is it for?', answer: 'Anyone, through the App Store' },
      { question: 'How far should the first version go?', answer: 'A polished first release' },
      { question: 'Where should it run?', answer: 'As an app on phones' },
      { question: 'What matters most in the first release?', answer: '“All three, but reminders that never fail come first.”' },
    ]);
    expect(sizingSentence(plant.proposal ?? demoProposal())).toMatch(/^You want a polished App Store release/);
    expect(plant.inbox).toBe(3);
    const lake = demoFoundingView(NOW);
    expect(draftState(lake)).toBe('drafting');
    expect(scopingAnswers(scopingOf(lake)).map((a) => a.answer)).toEqual(['Anyone sailing on Lake Geneva', 'Within minutes', '“French and German, please.”']);
    // The demo's own proposals hold to the hub's check, sizing included.
    const known = { libraryRoles: new Set(loadLibrary().roles.keys()), preset: 'thorough' as const };
    expect(checkProposal(demoProposal(), known).ok).toBe(true);
    expect(checkProposal(demoSmallProposal('Tiny Tool', 'A tiny tool.'), known)).toMatchObject({ ok: true, proposal: { size: 'small', people: [{ id: 'ceo' }, { reportsTo: 'ceo' }] } });
  });

  it('says why the CEO sized the org so, as it said it', () => {
    expect(sizingSentence({ sizing: 'Two people: one small CLI' })).toBe('Two people: one small CLI.');
    expect(sizingSentence({ sizing: '  ' })).toBeNull();
    expect(sizingSentence({})).toBeNull();
  });
});
