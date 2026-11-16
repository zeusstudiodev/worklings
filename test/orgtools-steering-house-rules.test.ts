// The house rules once a company serves steering: every desk acknowledges, decides and cites; while a plan governs,
// work comes from it; managers steer their team's tasks and the CEO proposes the plan and acts for the stakeholder only
// on their cited word. Without steering the rules are as they were, so no desk hears of a tool it doesn't have.
import { describe, expect, it } from 'vitest';
import { houseRules } from '../src/company/house-rules.ts';
import { peopleOf, personById } from '../src/core/company.ts';
import type { PlanApproval } from '../src/core/steering.ts';
import { STUDIO } from './orgtools-kit.ts';

const people = peopleOf(STUDIO);

function rulesFor(id: string, steering: { planApproval: PlanApproval } | null = null): string {
  const person = personById(people, id);
  if (!person) throw new Error(`no ${id}`);
  return houseRules({ person, people, company: 'Pickup Café', stakeholder: 'Robin', goal: 'Pickup orders online.', roomName: (room) => room, steering });
}

/** The tools the rules list, from their own section. */
const toolsListed = (rules: string) => (/## Your org tools\n\n(.+)\.\n?/.exec(rules)?.[1] ?? '').split(', ');

describe('the house rules on the words a turn ends with', () => {
  it("say they are shown to the stakeholder as the reply to their own message, and reach nobody else", () => {
    const rules = rulesFor('ui-designer');
    expect(rules).toContain("shown to Robin as your reply only when Robin's message began that turn and you sent no message in it");
    expect(rules).not.toContain('reaches nobody;');
  });
});

describe("the house rules once the company serves steering", () => {
  it('ask everyone to acknowledge messages, post decisions and cite what they act on', () => {
    const rules = rulesFor('ui-designer', { planApproval: 'off' });
    expect(rules).toContain('- Acknowledge every message from Robin and from your manager with ack as soon as it arrives, in one sentence: what you will do with it, or why you disagree.');
    expect(rules).toContain('- Post the decisions you make with decide: what you decided, why, and the alternatives you weighed.');
    expect(rules).toContain('- Cite the messages you act on by their ids ("m-12") in cites, on reports, status lines, tasks and decisions, so Robin sees what came of each.');
    expect(toolsListed(rules)).toEqual(['post_status', 'report', 'message', 'ask', 'org', 'tasks', 'share_screenshot', 'stakeholder_words', 'ack', 'decide']);
  });

  it('send work through the approved plan while one governs, and a gap in it to the manager', () => {
    const worker = rulesFor('frontend-engineer', { planApproval: 'before-work' });
    expect(worker).toContain("- While an approved plan governs the work, your work comes from it: the office hands you its tasks in order. When it misses something, tell your manager instead of starting work it doesn't have.");
    expect(rulesFor('frontend-engineer', { planApproval: 'off' })).not.toContain('approved plan');
    const ceo = rulesFor('ceo', { planApproval: 'milestones' });
    expect(ceo).toContain('When it misses something, tell Robin and propose a new version with propose_plan instead of starting work it doesn\'t have.');
  });

  it("let managers steer their own team's tasks, and assign only parts of approved tasks while a plan governs", () => {
    const head = rulesFor('head-of-design', { planApproval: 'before-work' });
    expect(head).toContain("- Steer your own team's tasks with steer_task: pause, resume, cancel with a reason, reassign with a note, or set their order.");
    expect(head).toContain('- While an approved plan governs the work, assign only a part of an approved task, inside its files, and name that task as its parent.');
    expect(toolsListed(head)).toContain('steer_task');
    expect(rulesFor('frontend-lead', { planApproval: 'off' })).not.toContain('assign only a part of an approved task');
    expect(toolsListed(rulesFor('ui-designer', { planApproval: 'before-work' }))).not.toContain('steer_task');
  });

  it('have the CEO propose the plan, revise it on request, and act for the stakeholder only on their cited word', () => {
    const ceo = rulesFor('ceo', { planApproval: 'before-work' });
    expect(ceo).toContain('- Once the company starts, propose the plan with propose_plan: the goal, milestones, and tasks with owner, files and order. When Robin says "revise it", propose a new version, citing their message.');
    expect(ceo).toContain('- approve_plan and change_settings act for Robin: use them only when they tell you to in a message to you, and cite it. They approve the plan themselves in the office too.');
    expect(toolsListed(ceo).slice(-7)).toEqual(['ack', 'decide', 'steer_task', 'propose_plan', 'approve_plan', 'change_settings', 'mark_checklist']);
  });
});

describe("the house rules while the company doesn't serve steering", () => {
  it('say nothing of its tools', () => {
    for (const id of ['ui-designer', 'head-of-design', 'ceo']) {
      const rules = rulesFor(id);
      for (const tool of ['ack', 'decide', 'steer_task', 'propose_plan', 'approve_plan', 'change_settings', 'mark_checklist']) expect(toolsListed(rules)).not.toContain(tool);
      for (const phrase of ['with ack', 'with decide', 'in cites', 'steer_task', 'propose_plan', 'approve_plan', 'change_settings', 'approved plan']) expect(rules).not.toContain(phrase);
    }
  });
});
