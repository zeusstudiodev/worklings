// The cast of an office that runs a company: its people at their desks with a body that says what they are doing
// (docs/game-feel.md, sections 4 and 7), visitors in reception, and v2's cast unchanged for an office that only watches.
import { defaultSettings } from '../src/core/company-state.ts';
import { describe, expect, it } from 'vitest';
import type { CompanyView, DeskView, PersonView, Question } from '../src/core/company.ts';
import { demoCompanyView, demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import type { AgentState } from '../src/core/office.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import type { Level, OfficeRoom } from '../src/core/studio.ts';
import { type Cast, type CastMember, castFrom, SeenLog } from '../web/src/scene/cast.ts';
import { computeLayout } from '../web/src/scene/layout.ts';
import { LOOK_MS, THINK_AFTER_MS } from '../web/src/scene/moments.ts';
import { POSES } from '../web/src/scene/poses.ts';

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
const at = (s: number) => T0 + Math.round(s * 1000);
const ROOMS: OfficeRoom[] = [
  { id: 'reception', title: 'Reception', kind: 'reception' },
  { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
];

function person(id: string, name: string, title: string, level: Level, room: string, reportsTo: string | null, desk: Partial<DeskView> = {}, extra: Partial<PersonView> = {}): PersonView {
  return {
    id, name, title, level, room, reportsTo, look: {}, model: 'sonnet', task: null, status: null, agentKey: `s-${id}:lead`, cost: 1.25,
    desk: { person: id, state: 'idle', sessionId: `s-${id}`, since: at(-600), context: 0.2, problem: null, queue: null, ...desk }, ...extra,
  };
}

function company(people: PersonView[], extra: Partial<CompanyView> = {}): CompanyView {
  return {
    id: 'cafe', name: 'Café Lumen', phase: 'running', prompt: 'A café website', stakeholder: 'Alex', branch: null, theme: 'cafe', rooms: ROOMS, goal: null, people,
    proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [], reports: [], dashboards: [], screenshots: [],
    spend: { samples: [], hourly: [], byPerson: [] }, log: [], pause: null,
    settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] }, desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null, ...extra,
  };
}

/** The cast of a browser that opens the office on this company at `t` seconds; `agents` changes the sessions it sees. */
function open(view: CompanyView, t: number, agents: (list: AgentState[]) => AgentState[] = (l) => l, narrow = false): Cast {
  const snapshot: Snapshot = demoSnapshot(view, 'C:\\cafe', at(t));
  snapshot.agents = agents(snapshot.agents);
  const layout = computeLayout(studioOf(view));
  const seen = new SeenLog();
  seen.note(snapshot, layout);
  return castFrom(snapshot, layout, { now: at(t), seen, narrow });
}

function member(cast: Cast, id: string): CastMember {
  const found = cast.members.find((m) => m.person === id);
  if (!found) throw new Error(`No ${id} among ${cast.members.map((m) => m.key).join(', ')}`);
  return found;
}

const team = () => [
  person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null),
  person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', { state: 'working', since: at(-30) }),
  person('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'head-of-design', { state: 'waiting', queue: 1 }),
  person('ux-designer', 'Jules', 'UX designer', 'worker', 'design', 'head-of-design', { state: 'waiting', queue: 2 }),
  person('head-of-engineering', 'Theo', 'Head of engineering', 'head', 'engineering', 'ceo', { state: 'closed', sessionId: null }),
  person('frontend-engineer', 'Kai', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering', { state: 'failed', since: at(-125) }),
  person('qa-engineer', 'Ravi', 'QA engineer', 'worker', 'quality', 'head-of-engineering', { state: 'starting', since: at(-2) }),
];

describe('people at their desks', () => {
  it('types while working, thinks while a desk opens, reads their task while waiting for a desk, holds their head when stuck', () => {
    const cast = open(company(team()), 0);
    expect(member(cast, 'head-of-design').body).toMatchObject({ pose: 'type', holding: 'none', visitor: false });
    expect(member(cast, 'head-of-design').seated).toBe(true);
    expect(member(cast, 'qa-engineer').body.pose).toBe('think');
    expect(member(cast, 'ui-designer').body).toMatchObject({ pose: 'read', holding: 'task' });
    expect(member(cast, 'frontend-engineer').body.pose).toBe('stuck');
    expect(member(cast, 'ceo').body.pose).toBe('rest');
    expect(member(cast, 'head-of-engineering').body.pose).toBe('rest');
    for (const m of cast.members) expect(POSES).toContain(m.body.pose);
  });

  it('says what they are on, that they are stuck, and who is next for a desk', () => {
    const view = company(team());
    const ada = view.people.find((p) => p.id === 'head-of-design');
    if (ada) {
      ada.task = 't-1';
      ada.status = { person: ada.id, text: 'Passing your palette note to Mina.', taskId: 't-1', at: at(-10) };
    }
    const cast = open(view, 0);
    expect(member(cast, 'head-of-design').bubble).toEqual({ tone: 'on-it', lead: null, text: 'Passing your palette note…', dot: 'still' });
    expect(member(cast, 'frontend-engineer').bubble).toEqual({ tone: 'stuck', lead: null, text: 'Stuck for 2 min', dot: null });
    expect(member(cast, 'ui-designer').bubble).toMatchObject({ text: 'Next for a desk' });
    expect(member(cast, 'ux-designer').bubble).toBeNull();
    expect(member(cast, 'head-of-engineering').bubble).toBeNull();
  });

  it('thinks, chin on hand, after 4 s with no step running, and types again with none of it per tool call', () => {
    const view = company(team());
    const quiet = (since: number) => (list: AgentState[]) => list.map((a) => (a.roleId === 'head-of-design' ? { ...a, status: 'thinking' as const, tool: null, lastEventAt: at(since) } : a));
    expect(member(open(view, 0, quiet(-5)), 'head-of-design').body).toMatchObject({ pose: 'think', since: at(-5) + THINK_AFTER_MS });
    const typing = open(view, 0, quiet(-2));
    expect(member(typing, 'head-of-design').body.pose).toBe('type');
    expect(typing.nextChangeAt).toBe(at(-2) + THINK_AFTER_MS);
  });

  it('shows a long day as cups and a slouch: one at half the context, two at three quarters, three at 90%', () => {
    const view = company([
      person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null, { context: 0.49 }),
      person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo', { context: 0.5 }),
      person('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'head-of-design', { context: 0.75 }),
      person('ux-designer', 'Jules', 'UX designer', 'worker', 'design', 'head-of-design', { context: 0.93 }),
      person('copywriter', 'Lena', 'Copywriter', 'worker', 'content', 'ceo', { context: null }),
    ]);
    const cast = open(view, 0);
    expect(['ceo', 'head-of-design', 'ui-designer', 'ux-designer', 'copywriter'].map((id) => member(cast, id).body.tired)).toEqual([0, 1, 2, 3, 0]);
    expect(cast.props?.cups).toHaveLength(6);
  });

  it('drops the cups when context compacts', () => {
    const tired = company([person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null, { context: 0.92 })]);
    const rested = company([person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null, { context: 0.31 })]);
    expect(open(tired, 0).props?.cups).toHaveLength(3);
    expect(open(rested, 1).props?.cups).toHaveLength(0);
    expect(member(open(rested, 1), 'ceo').body.tired).toBe(0);
  });

  it('dresses people from their look, keeps their rest pose, and gives the CEO the gold', () => {
    const view = company([
      person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null),
      person('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'ceo', {}, { look: { body: 'mage', prop: 'tablet', color: '#336699' } }),
    ]);
    const first = open(view, 0);
    const later = open(view, 90);
    expect(member(first, 'ui-designer').body.outfit).toEqual({ body: 'mage', prop: 'tablet', color: '#336699' });
    expect(member(first, 'ui-designer').body.restPose).toBe(member(later, 'ui-designer').body.restPose);
    expect([0, 1, 2]).toContain(member(first, 'ui-designer').body.restPose);
    expect(member(first, 'ceo').hue).toBe('#C9B458');
    expect(member(first, 'ceo').level).toBe('ceo');
    expect(member(first, 'ui-designer')).toMatchObject({ key: 'desk:ui-designer', target: { kind: 'role', id: 'ui-designer' }, title: 'Mina, UI designer', room: 'design' });
  });

  it('sits back to look at you after a Stop, for a moment', () => {
    const view = company([person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null, { state: 'stopping', since: at(0) })]);
    expect(member(open(view, 0.5), 'ceo').body).toMatchObject({ pose: 'look', since: at(0) });
    expect(member(open(view, LOOK_MS / 1000 + 0.1), 'ceo').body.pose).toBe('rest');
  });

  it('seats people at the desk the layout gives them', () => {
    const view = company(team());
    const layout = computeLayout(studioOf(view));
    const cast = open(view, 0);
    for (const p of view.people) {
      const seat = layout.office?.byPerson.get(p.id)?.seat;
      expect(member(cast, p.id)).toMatchObject({ x: seat?.x, z: seat?.z, walk: [] });
    }
  });
});

describe('questions for you', () => {
  const asked = (id: string, from: string, text: string, gate: Question['gate'] = null): Question => ({
    id, from, text, options: ['Start it', 'Not yet'], recommended: 0, taskId: 't-2', askedAt: at(-60), answer: null, withdrawn: null, gate,
  });

  it('brings an ordinary question to the front desk, but leaves someone whose next task waits for your say at work', () => {
    const view = company(team(), {
      questions: [
        asked('q-1', 'head-of-design', 'Can I start “Darker palette”? You asked me to check with you before each task.', { task: 't-2' }),
        asked('q-2', 'ceo', 'Should guests be able to pay by card as well?'),
      ],
    });
    const cast = open(view, 0);
    expect(cast.moments.frontDesk).toEqual(['ceo']);
    expect(member(cast, 'ceo')).toMatchObject({ inLine: 0, item: 'q-2', status: 'waiting', body: { pose: 'wait', holding: 'note-yours' } });
    expect(member(cast, 'ceo').bubble).toMatchObject({ tone: 'needs-you', lead: 'Asks you:' });
    // Still at work on the task before: typing at their desk, saying what they are on, not in line or stuck.
    const ada = member(cast, 'head-of-design');
    expect(ada).toMatchObject({ inLine: null, item: null, status: 'working', papers: 0, seated: true, body: { pose: 'type', holding: 'none' } });
    expect(ada.bubble?.tone).toBe('on-it');
    const seat = computeLayout(studioOf(view)).office?.byPerson.get('head-of-design')?.seat;
    expect(ada).toMatchObject({ x: seat?.x, z: seat?.z, walk: [] });
  });

  it('leaves someone idle between tasks at rest with a gate open, not waiting at the desk', () => {
    const view = company(team(), { questions: [asked('q-1', 'head-of-engineering', 'Can I start “Cart summary”?', { task: 't-2' })] });
    const theo = member(open(view, 0), 'head-of-engineering');
    expect(theo).toMatchObject({ inLine: null, item: null, bubble: null, body: { pose: 'rest' } });
    expect(open(view, 0).moments.frontDesk).toEqual([]);
  });
});

describe('visitors', () => {
  it("seats sessions the company didn't start in reception as mannequins with v2's bubbles", () => {
    const view = company(team());
    const visitor: AgentState = {
      ...demoSnapshot(view, 'C:\\cafe', at(0)).agents[0] as AgentState,
      key: 'outside:lead', sessionId: 'outside', roleId: null, kind: 'lead', name: 'Lead', status: 'waiting', waitingFor: 'run npm install', agentType: 'lead',
    };
    const cast = open(view, 0, (list) => [...list, visitor]);
    const guest = cast.members.find((m) => m.key === 'outside:lead');
    const layout = computeLayout(studioOf(view));
    expect(guest?.body.visitor).toBe(true);
    expect(guest?.person).toBeNull();
    expect(guest?.bubble).toMatchObject({ tone: 'needs-you', text: 'Needs your OK to run npm…' });
    expect(layout.office?.reception.seats.some((s) => s.x === guest?.x && s.z === guest?.z)).toBe(true);
    // Visitors never queue at the front desk.
    expect(cast.moments.frontDesk).toEqual([]);
  });

  it('shows the company people as themselves, not as visitors', () => {
    const cast = open(company(team()), 0);
    expect(cast.members.filter((m) => m.body.visitor)).toEqual([]);
    expect(cast.members).toHaveLength(team().length);
  });
});

describe('the demo café', () => {
  it('has someone in every state the office draws', () => {
    const now = Date.UTC(2026, 10, 5, 12);
    const snapshot = demoSnapshot(demoCompanyView(now), 'C:\\cafe', now);
    const layout = computeLayout(snapshot.studio);
    const cast = castFrom(snapshot, layout, {});
    const poses = new Set(cast.members.map((m) => m.body.pose));
    for (const pose of ['type', 'think', 'read', 'stuck', 'rest', 'wait', 'lounge'] as const) expect(poses).toContain(pose);
    expect(cast.moments.frontDesk.length).toBeGreaterThan(0);
    expect(cast.members.some((m) => m.person === 'devops-engineer')).toBe(false);
    expect(cast.tier).toBe('ambient');
  });
});

describe('an office that only watches', () => {
  it('keeps no moments or props, and still gives people a body', () => {
    const view = company(team());
    const snapshot = demoSnapshot(view, 'C:\\cafe', at(0));
    const studio = studioOf(view);
    const v2 = { ...studio, roles: studio.roles.map(({ level: _l, reportsTo: _r, ...r }) => r) };
    delete v2.office;
    const watching = { ...snapshot, company: null, studio: v2 };
    const cast = castFrom(watching, computeLayout(v2), { now: at(0) });
    expect(cast.moments).toEqual({ night: 0, trays: [], frontDesk: [], celebration: null });
    expect(cast.props).toBeNull();
    expect(cast.night).toBeNull();
    expect(cast.members.some((m) => m.person !== null)).toBe(false);
    const ada = cast.members.find((m) => m.key === 'desk:head-of-design');
    expect(ada?.body.pose).toBe('type');
    expect(ada?.person).toBeNull();
  });
});
