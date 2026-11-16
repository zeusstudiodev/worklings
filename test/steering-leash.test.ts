// The leash and settings (src/company/leash.ts): each person's leash, effort and model, the "check with me" start, and
// changeSettings for the stakeholder and for the CEO on the stakeholder's word, with Trusted by talking confirmed in
// the inbox.
import { DEFAULT_PRESET, PRESETS } from '../src/core/presets.ts';
import { describe, expect, it } from 'vitest';
import { createTask } from '../src/company/board.ts';
import { answerDecision, applyEvents } from '../src/company/decisions.ts';
import { changeSettings, confirmAnswered, deskSteering, gateAnswered } from '../src/company/leash.ts';
import { proposePlan, approvePlan } from '../src/company/plan.ts';
import type { Question } from '../src/core/company.ts';
import { LEASHES, type Leash, type SettingsChange } from '../src/core/steering.ts';
import { effectiveLeash, heldTurn, personSteering } from '../src/core/steering-state.ts';
import { PEOPLE, rawPlan, refusal, Sim, STAKEHOLDER, THE_OFFICE } from './steering-core-kit.ts';
import { withChecklist } from './steering-plan-kit.ts';

/** The desks at once a new company starts with: its preset's (Balanced). */
const DESKS = PRESETS[DEFAULT_PRESET].desks;

const change = (sim: Sim, by: string, c: SettingsChange, cites: string[] = []) => sim.run((ctx) => changeSettings(ctx, by, { ...c, cites }));
const host = (sim: Sim) => ({ tasks: sim.state.tasks, assignments: sim.state.assignments, steering: sim.steering });
const lena = PEOPLE.find((p) => p.id === 'german-copywriter') ?? PEOPLE[0];

/** Answers a question the way the company does once the undo window has passed. */
function answer(sim: Sim, q: Question, option: number | null, text = ''): Question {
  const answered = { ...q, answer: { option, text, at: sim.now, appliesAt: sim.now } };
  sim.world = applyEvents(sim.world, [{ type: 'answer', id: q.id, answer: answered.answer }, { type: 'applied', id: q.id, at: sim.now }]);
  return answered;
}

describe("a person's leash", () => {
  it('is their own, else their room\'s, else the company\'s approvals', () => {
    const settings = { planApproval: 'before-work' as const, leash: { people: { 'german-copywriter': 'check' as Leash }, rooms: { content: 'trusted' as Leash, design: 'check' as Leash } }, effort: { 'ui-designer': 'xhigh' as const } };
    expect(effectiveLeash(settings, { id: 'german-copywriter', room: 'content' })).toEqual({ leash: 'check', leashFrom: 'person', effort: null });
    expect(effectiveLeash(settings, { id: 'ui-designer', room: 'design' })).toEqual({ leash: 'check', leashFrom: 'room', effort: 'xhigh' });
    expect(effectiveLeash(settings, { id: 'ceo', room: 'direction' })).toEqual({ leash: 'default', leashFrom: 'company', effort: null });
    expect(Object.keys(personSteering(settings, PEOPLE))).toEqual(PEOPLE.map((p) => p.id));
  });

  it('reaches the next desk with the effort beside it', () => {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { leash: { room: 'design', leash: 'trusted' } });
    change(sim, STAKEHOLDER, { effort: { person: 'ui-designer', effort: 'high' } });
    expect(deskSteering(sim.steering, { id: 'ui-designer', room: 'design' })).toEqual({ effort: 'high', leash: 'trusted' });
    expect(deskSteering(sim.steering, { id: 'ceo', room: 'direction' })).toEqual({ effort: null, leash: 'default' });
  });

  it("can't be keyed by a name that is a property of every object", () => {
    const sim = new Sim();
    expect(effectiveLeash(sim.steering.settings, { id: 'constructor', room: '__proto__' })).toEqual({ leash: 'default', leashFrom: 'company', effort: null });
  });
});

describe('check with me', () => {
  function checking(): { sim: Sim; taskId: string; question: Question } {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { leash: { person: 'german-copywriter', leash: 'check' } });
    const t = sim.run((c) => createTask(c, STAKEHOLDER, { title: 'Write the DE copy', brief: 'The menu in German.', files: ['content/de/'], owner: 'german-copywriter', doneWhen: 'Every page reads well.', milestone: null, cites: [] }));
    const question = sim.state.questions.at(-1);
    if (!question) throw new Error('No question was asked.');
    return { sim, taskId: t.id, question };
  }

  it('holds each new task behind a question from the office', () => {
    const { sim, taskId, question } = checking();
    expect(question).toMatchObject({ from: THE_OFFICE, gate: { task: taskId }, text: `Lena would like to start “Write the DE copy”. Start it, or hold it until you resume it?`, options: ['Start it', 'Not now'], taskId });
    expect(heldTurn(host(sim), sim.assignmentOf(taskId)?.id ?? '')).toBe('gate');
    expect(sim.waiting('german-copywriter')).toEqual([]);
  });

  it('hands the task out when the stakeholder says start', () => {
    const { sim, taskId, question } = checking();
    const answered = answer(sim, question, 0);
    sim.run((c) => gateAnswered(c, answered));
    expect(sim.waiting('german-copywriter').map((m) => m.id)).toEqual([sim.assignmentOf(taskId)?.id]);
    sim.apply([{ events: answerDecision(sim.ctx(), answered), effects: [] }]);
    expect(sim.lastDecision()).toMatchObject({ kind: 'answer', what: 'You let Lena start “Write the DE copy”.', links: { question: question.id, task: taskId } });
  });

  it('pauses the task on "not now", so Resume on the board starts it later, and passes on the words', () => {
    const { sim, taskId, question } = checking();
    const answered = answer(sim, question, 1, 'After the English copy.');
    sim.run((c) => gateAnswered(c, answered));
    expect(sim.task(taskId).paused).toEqual({ at: sim.now, by: STAKEHOLDER });
    expect(heldTurn(host(sim), sim.assignmentOf(taskId)?.id ?? '')).toBe('paused');
    expect(sim.lastTo('german-copywriter')).toMatchObject({ from: STAKEHOLDER, text: `On ${taskId}, “Write the DE copy”: After the English copy.`, deliveredAt: null });
    expect(sim.waiting('german-copywriter')).toEqual([]);
    sim.apply([{ events: answerDecision(sim.ctx(), answered), effects: [] }]);
    expect(sim.lastDecision().what).toBe('You held “Write the DE copy” back from Lena: Not now: After the English copy.');
  });

  it('lets held starts go out when the person no longer checks', () => {
    const { sim, taskId, question } = checking();
    change(sim, STAKEHOLDER, { leash: { person: 'german-copywriter', leash: null } });
    expect(sim.state.questions.find((q) => q.id === question.id)?.withdrawn?.reason).toBe("Lena doesn't check with you before each task any more.");
    expect(sim.waiting('german-copywriter').map((m) => m.id)).toEqual([sim.assignmentOf(taskId)?.id]);
  });

  it("withdraws the question when the task's owner is gone", () => {
    const { sim, question } = checking();
    sim.people = sim.people.filter((p) => p.id !== 'german-copywriter');
    sim.world = applyEvents(sim.world, [{ type: 'task-status', id: sim.state.tasks[0]?.id ?? '', status: 'dropped', at: sim.now, outcome: 'Lena was fired before it was done.' }]);
    sim.settle();
    expect(sim.state.questions.find((q) => q.id === question.id)?.withdrawn?.reason).toBe('The task is over.');
    expect(sim.steering.gates).toEqual({});
  });

  it("holds a plan task whose owner checks first", () => {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { leash: { room: 'design', leash: 'check' } });
    sim.run((c) => proposePlan(c, 'ceo', withChecklist(rawPlan())));
    sim.run((c) => approvePlan(c, STAKEHOLDER, { version: 1, through: null, cites: [] }));
    expect(sim.state.questions.filter((q) => q.gate).map((q) => q.text)).toEqual([`Kai would like to start “Menu look”. Start it, or hold it until you resume it?`]);
    expect(sim.waiting('ui-designer')).toEqual([]);
  });
});

describe('the stakeholder changing settings', () => {
  it('sets desks at once through the company\'s path, with a decision Undo can take back', () => {
    const sim = new Sim();
    const result = change(sim, STAKEHOLDER, { maxDesks: 4 });
    expect(result.planApproval).toBe('before-work');
    expect(sim.state.settings.maxDesks).toBe(4);
    expect(sim.effects).toContainEqual({ kind: 'company-settings', by: STAKEHOLDER, change: { maxDesks: 4 } });
    const d = sim.lastDecision();
    expect(d).toMatchObject({ kind: 'setting', by: STAKEHOLDER, what: 'You set 4 desks at once.', reversible: true });
    expect(sim.steering.undos[d.id]).toEqual({ kind: 'settings', key: 'setting:maxDesks', change: { maxDesks: DESKS } });
  });

  it('sets the idle time, plan approval, effort and model, each its own decision', () => {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { idleMs: 600_000, planApproval: 'milestones', effort: { person: 'backend-engineer', effort: 'xhigh' }, model: { person: 'ui-designer', model: 'opus' } });
    expect(sim.decisions().map((d) => d.what)).toEqual([
      'You set idle desks to close after 10 min.',
      'You set plan approval to “At every milestone”.',
      "You set Noah's effort to extra high.",
      'You moved Kai to Opus.',
    ]);
    expect(sim.state.settings.idleMs).toBe(600_000);
    expect(sim.steering.settings.planApproval).toBe('milestones');
    expect(sim.models['ui-designer']).toBe('opus');
    expect(sim.decisions().map((d) => sim.steering.undos[d.id])).toEqual([
      { kind: 'settings', key: 'setting:idleMs', change: { idleMs: 300_000 } },
      { kind: 'settings', key: 'setting:planApproval', change: { planApproval: 'before-work' } },
      { kind: 'settings', key: 'effort:backend-engineer', change: { effort: { person: 'backend-engineer', effort: null } } },
      { kind: 'settings', key: 'model:ui-designer', change: { model: { person: 'ui-designer', model: 'sonnet' } } },
    ]);
  });

  it("sets effort back to Claude Code's default", () => {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { effort: { person: 'backend-engineer', effort: 'max' } });
    change(sim, STAKEHOLDER, { effort: { person: 'backend-engineer', effort: null } });
    expect(sim.lastDecision().what).toBe("You set Noah's effort to Claude Code's default.");
    expect(Object.hasOwn(sim.steering.settings.effort, 'backend-engineer')).toBe(false);
  });

  it('removes an Always allow rule, which Undo can put back', () => {
    const sim = new Sim();
    sim.world = applyEvents(sim.world, [{ type: 'settings', settings: { ...sim.state.settings, alwaysAllow: ['Bash(npx playwright test:*)'] } }]);
    change(sim, STAKEHOLDER, { removeRule: 'Bash(npx playwright test:*)' });
    expect(sim.state.settings.alwaysAllow).toEqual([]);
    const d = sim.lastDecision();
    expect(d).toMatchObject({ kind: 'rule', what: 'You removed the rule Bash(npx playwright test:*), so it is asked again.' });
    expect(sim.steering.undos[d.id]).toEqual({ kind: 'settings', key: 'rule:Bash(npx playwright test:*)', change: { addRule: 'Bash(npx playwright test:*)' } });
  });

  it('records nothing for a setting that stays as it was', () => {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { maxDesks: DESKS });
    expect(sim.decisions()).toEqual([]);
  });

  it('refuses values out of range and changes that name nothing', () => {
    const sim = new Sim();
    expect(refusal(() => change(sim, STAKEHOLDER, { maxDesks: 0 })).message).toBe('Desks at once is a whole number from 1 to 20.');
    expect(refusal(() => change(sim, STAKEHOLDER, { maxDesks: 2.5 })).message).toBe('Desks at once is a whole number from 1 to 20.');
    expect(refusal(() => change(sim, STAKEHOLDER, { idleMs: 1_000 })).message).toBe('An idle desk closes after 1 to 120 minutes, given in milliseconds.');
    expect(refusal(() => change(sim, STAKEHOLDER, { idleMs: 7_200_001 })).code).toBe('invalid');
    expect(refusal(() => change(sim, STAKEHOLDER, { planApproval: 'sometimes' as never })).message).toBe('Plan approval is before-work, milestones or off.');
    expect(refusal(() => change(sim, STAKEHOLDER, { leash: { person: 'german-copywriter', leash: 'loose' as never } })).message).toBe('A leash is check, default or trusted, or null to clear one of their own.');
    expect(refusal(() => change(sim, STAKEHOLDER, { leash: { room: 'kitchen', leash: 'check' } })).message).toBe("There's no room kitchen in the company.");
    expect(refusal(() => change(sim, STAKEHOLDER, { effort: { person: 'ui-designer', effort: 'huge' as never } })).code).toBe('invalid');
    expect(refusal(() => change(sim, STAKEHOLDER, { model: { person: 'ui-designer', model: 'gpt-5' } })).message).toBe('A model is one of inherit, sonnet, opus, haiku.');
    expect(refusal(() => change(sim, STAKEHOLDER, { model: { person: 'nobody', model: 'opus' } })).code).toBe('unknown');
    expect(refusal(() => change(sim, STAKEHOLDER, { removeRule: 'Bash(rm -rf:*)' })).message).toBe("There's no such rule to remove.");
    expect(refusal(() => change(sim, STAKEHOLDER, {})).message).toBe('Say which setting to change.');
  });
});

describe('every leash, on a person and on a room', () => {
  const values: (Leash | null)[] = [...LEASHES, null];
  const sentences: Record<string, string> = {
    'person:check': 'You set Lena to check with you before each task.',
    'person:default': "You put Lena on the company's approvals.",
    'person:trusted': 'You made Lena Trusted.',
    'person:null': "You cleared Lena's own leash, so Lena follows the Content room: the company's approvals.",
    'room:check': 'You set the Content room to check with you before each task.',
    'room:default': "You put the Content room on the company's approvals.",
    'room:trusted': 'You made the Content room Trusted.',
    'room:null': "You cleared the Content room's leash, so its people are on the company's approvals unless they have their own.",
  };

  for (const target of ['person', 'room'] as const) {
    for (const value of values) {
      it(`sets ${target === 'person' ? 'Lena' : 'the Content room'} to ${value ?? 'nothing of their own'}, with the change that undoes it`, () => {
        const sim = new Sim();
        const before: Leash = value === 'check' ? 'trusted' : 'check';
        const leash = target === 'person' ? { person: 'german-copywriter', leash: before } : { room: 'content', leash: before };
        change(sim, STAKEHOLDER, { leash });
        change(sim, STAKEHOLDER, { leash: target === 'person' ? { person: 'german-copywriter', leash: value } : { room: 'content', leash: value } });
        const d = sim.lastDecision();
        expect(d).toMatchObject({ kind: 'leash', what: sentences[`${target}:${value}`], rooms: ['content'] });
        expect(sim.steering.undos[d.id]).toEqual({
          kind: 'settings',
          key: target === 'person' ? 'leash:person:german-copywriter' : 'leash:room:content',
          change: { leash: target === 'person' ? { person: 'german-copywriter', leash: before } : { room: 'content', leash: before } },
        });
        const now = effectiveLeash(sim.steering.settings, lena ?? { id: 'german-copywriter', room: 'content' });
        expect(now.leash).toBe(value ?? 'default');
        // The desks at once change the same way whatever anyone's leash is.
        change(sim, STAKEHOLDER, { maxDesks: 3 });
        expect(sim.state.settings.maxDesks).toBe(3);
      });
    }
  }
});

describe('the CEO changing settings on the stakeholder\'s word', () => {
  it('is refused without a cite, and for anyone but the CEO', () => {
    const sim = new Sim();
    expect(refusal(() => change(sim, 'ceo', { maxDesks: 4 })).message).toBe(
      "The CEO acts for Robin only on Robin's word: cite the message where Robin asked for this (the desks at once).",
    );
    const word = sim.say('head-of-design', 'Only four people at once.');
    expect(refusal(() => change(sim, 'head-of-design', { maxDesks: 4 }, [word.id])).message).toBe('Only the CEO changes settings, when Robin asks; tell the CEO.');
  });

  it("is refused citing another person's message or the stakeholder's message to someone else", () => {
    const sim = new Sim();
    const fromAda = sim.post('head-of-design', 'ceo', 'Robin wants four.');
    const toAda = sim.say('head-of-design', 'Only four people at once.');
    expect(refusal(() => change(sim, 'ceo', { maxDesks: 4 }, [fromAda.id])).message).toBe(`Message ${fromAda.id} is from Ada, not Robin; cite Robin's own message.`);
    expect(refusal(() => change(sim, 'ceo', { maxDesks: 4 }, [toAda.id])).message).toBe(`Message ${toAda.id} went to Ada; cite a message Robin sent Noor.`);
    expect(refusal(() => change(sim, 'ceo', { maxDesks: 4 }, ['m-404'])).message).toBe("There's no message m-404; cite the message where Robin asked for this.");
  });

  it('applies with a fresh cite, says so in the log, and never twice on the same word', () => {
    const sim = new Sim();
    const word = sim.say('ceo', 'Only four people at once.');
    sim.tick();
    change(sim, 'ceo', { maxDesks: 4 }, [word.id]);
    expect(sim.lastDecision()).toMatchObject({ by: 'ceo', what: 'The CEO set 4 desks at once, as you asked.', links: { message: word.id } });
    sim.tick();
    expect(refusal(() => change(sim, 'ceo', { maxDesks: 6 }, [word.id])).message).toMatch(new RegExp(`^Message ${word.id} is older than the last change to the desks at once \\(at \\d\\d:\\d\\d\\); cite what Robin said since\\.$`));
  });

  it('is refused for a message older than the change the stakeholder made since', () => {
    const sim = new Sim();
    const old = sim.say('ceo', 'Lena checks with me before each task.');
    sim.tick();
    change(sim, STAKEHOLDER, { leash: { person: 'german-copywriter', leash: 'default' } });
    sim.tick();
    expect(refusal(() => change(sim, 'ceo', { leash: { person: 'german-copywriter', leash: 'check' } }, [old.id])).code).toBe('not-allowed');
    const fresh = sim.say('ceo', 'Lena checks with me before each task after all.');
    change(sim, 'ceo', { leash: { person: 'german-copywriter', leash: 'check' } }, [fresh.id]);
    expect(sim.lastDecision().what).toBe('The CEO set Lena to check with you before each task, as you asked.');
  });

  it('asks the stakeholder before making someone Trusted, and applies the rest at once', () => {
    const sim = new Sim();
    const word = sim.say('ceo', 'Make Kai Trusted, and give him high effort.');
    sim.tick();
    change(sim, 'ceo', { leash: { person: 'ui-designer', leash: 'trusted' }, effort: { person: 'ui-designer', effort: 'high' } }, [word.id]);
    expect(effectiveLeash(sim.steering.settings, { id: 'ui-designer', room: 'design' })).toMatchObject({ leash: 'default', effort: 'high' });
    const q = sim.state.questions.at(-1);
    expect(q).toMatchObject({ from: 'ceo', options: ['Make Kai Trusted', 'Keep the leash as it is'] });
    expect(q?.text).toMatch(/^The CEO would make Kai Trusted, as you asked: routine work in the project without asking/);
    expect(sim.steering.confirms[q?.id ?? '']).toEqual({ by: 'ceo', cites: [word.id], target: { person: 'ui-designer' } });
    if (!q) return;
    sim.run((c) => confirmAnswered(c, answer(sim, q, 0)));
    expect(effectiveLeash(sim.steering.settings, { id: 'ui-designer', room: 'design' }).leash).toBe('trusted');
    expect(sim.lastDecision()).toMatchObject({ by: 'ceo', kind: 'leash', what: 'The CEO made Kai Trusted, as you asked.', links: { message: word.id, question: q.id } });
    expect(sim.steering.confirms).toEqual({});
  });

  it('keeps the leash as it was when the stakeholder says no', () => {
    const sim = new Sim();
    const word = sim.say('ceo', 'Make the design room Trusted.');
    change(sim, 'ceo', { leash: { room: 'design', leash: 'trusted' } }, [word.id]);
    const q = sim.state.questions.at(-1);
    if (!q) throw new Error('No question was asked.');
    const decisions = sim.decisions().length;
    sim.run((c) => confirmAnswered(c, answer(sim, q, 1)));
    expect(sim.steering.settings.leash.rooms).toEqual({});
    expect(sim.decisions()).toHaveLength(decisions);
    expect(sim.steering.confirms).toEqual({});
  });

  it('lets the stakeholder make someone Trusted without asking', () => {
    const sim = new Sim();
    change(sim, STAKEHOLDER, { leash: { person: 'ui-designer', leash: 'trusted' } });
    expect(sim.state.questions).toEqual([]);
    expect(sim.lastDecision().what).toBe('You made Kai Trusted.');
  });
});
