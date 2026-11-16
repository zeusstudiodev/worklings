// The label layer over a company's office (docs/game-feel.md, sections 2, 4 and 6; docs/design-v3.md): a sign over
// every room with no v2 lobby or lead, the front desk's sign and what each waiter opens, the line over the door at
// night, when the office screen may run the app live, and how the fixed labels stack with the rest.
import { defaultSettings } from '../src/core/company-state.ts';
import { describe, expect, it } from 'vitest';
import { type Approval, type CompanyView, type DeskView, type PersonView, type Question, UNDO_MS } from '../src/core/company.ts';
import { demoCompanyView, demoProposal, demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import type { Level, OfficeRoom } from '../src/core/studio.ts';
import { companyState, stateOfCompany } from '../web/src/company/model.ts';
import { type Cast, castFrom, type CastMember, itemOf, SeenLog } from '../web/src/scene/cast.ts';
import { computeLayout } from '../web/src/scene/layout.ts';
import {
  bubbleShown, facesCamera, frontDeskSign, itemPath, LIVE_SCREEN_MIN_PX, nightLine, officeSigns, onScreen, type ScreenCorners, screenLive,
} from '../web/src/scene/officeLabels.ts';
import { planOffice } from '../web/src/scene/office/plan.ts';
import { type LabelBox, stackLabels } from '../web/src/scene/stack.ts';

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
const at = (s: number) => T0 + Math.round(s * 1000);
/** The clock in UTC, so the tests read the same in every time zone. */
const utc = (t: number) => new Date(t).toISOString().slice(11, 16);

const ROOMS: OfficeRoom[] = [
  { id: 'reception', title: 'Reception', kind: 'reception' },
  { id: 'ceo-office', title: "CEO's office", kind: 'ceo' },
  { id: 'meeting', title: 'Meeting room', kind: 'meeting' },
  { id: 'kitchen', title: 'Kitchen', kind: 'kitchen' },
];

function person(id: string, name: string, title: string, level: Level, room: string, reportsTo: string | null, desk: Partial<DeskView> = {}): PersonView {
  return {
    id, name, title, level, room, reportsTo, look: {}, model: 'sonnet', task: null, status: null, agentKey: `s-${id}:lead`, cost: 0.4,
    desk: { person: id, state: 'idle', sessionId: `s-${id}`, since: at(-600), context: 0.2, problem: null, queue: null, ...desk },
  };
}

/** Café Lumen: the CEO, two heads and their people in four rooms, everyone idle at their desk. */
function cafe(extra: Partial<CompanyView> = {}): CompanyView {
  return {
    id: 'cafe', name: 'Café Lumen', phase: 'running', prompt: 'A café website', stakeholder: 'Alex', branch: null, theme: 'cafe', rooms: ROOMS, goal: null,
    people: [
      person('ceo', 'Mara', 'CEO', 'ceo', 'direction', null),
      person('head-of-design', 'Ada', 'Head of design', 'head', 'design', 'ceo'),
      person('ui-designer', 'Mina', 'UI designer', 'worker', 'design', 'head-of-design'),
      person('ux-designer', 'Jules', 'UX designer', 'worker', 'design', 'head-of-design'),
      person('head-of-engineering', 'Theo', 'Head of engineering', 'head', 'engineering', 'ceo'),
      person('frontend-engineer', 'Kai', 'Frontend engineer', 'worker', 'engineering', 'head-of-engineering'),
      person('backend-engineer', 'Noah', 'Backend engineer', 'worker', 'engineering', 'head-of-engineering'),
      person('devops-engineer', 'Marco', 'DevOps engineer', 'worker', 'engineering', 'head-of-engineering'),
      person('copywriter', 'Lena', 'Copywriter', 'worker', 'content', 'ceo'),
      person('qa-engineer', 'Ravi', 'QA engineer', 'worker', 'quality', 'head-of-engineering'),
    ],
    proposal: null, tasks: [], messages: [], questions: [], approvals: [], statuses: [], reports: [], dashboards: [], screenshots: [],
    spend: { samples: [], hourly: [], byPerson: [] }, log: [], pause: null,
    settings: { ...defaultSettings(), maxDesks: 8, idleMs: 300_000, billing: 'plan', alwaysAllow: [] }, desks: { working: 0, waiting: 0, max: 8 },
    preview: { state: 'off', url: null, command: null, problem: null }, inbox: 0, seen: {}, proposalEdited: false, problem: null, ...extra,
  };
}

const approval = (id: string, who: string, t: number, extra: Partial<Approval> = {}): Approval => ({
  id, person: who, tool: 'Bash', summary: 'Push the work branch to GitHub', detail: 'git push origin main', kind: 'push', askedAt: at(t), expiresAt: at(t + 900),
  alwaysRule: null, answer: null, withdrawn: null, ...extra,
});
const question = (id: string, from: string, t: number, extra: Partial<Question> = {}): Question => ({
  id, from, text: 'Which payment provider?', options: ['TWINT', 'Stripe'], recommended: 0, taskId: null, askedAt: at(t), answer: null, withdrawn: null, ...extra,
});

/** The cast of an office watched from `t0` seconds that then sees `view` at `t`, the way useCast notes each snapshot. */
function watched(view: CompanyView, t: number, options: { narrow?: boolean; t0?: number } = {}): Cast {
  const seen = new SeenLog();
  const first = structuredClone(view);
  first.questions = [];
  first.approvals = [];
  const before = demoSnapshot(first, 'C:\\cafe', at(options.t0 ?? 0));
  const layout = computeLayout(studioOf(view));
  seen.note(before, layout);
  const now = demoSnapshot(view, 'C:\\cafe', at(t));
  seen.note(now, layout);
  return castFrom(now, layout, { now: at(t + 30), seen, narrow: options.narrow ?? false });
}

const byPerson = (cast: Cast, id: string): CastMember => {
  const found = cast.members.find((m) => m.person === id);
  if (!found) throw new Error(`No ${id}`);
  return found;
};

describe('room signs in a company office', () => {
  const layout = computeLayout(studioOf(cafe()));

  it('has a sign over every room: the departments in their hue, then the office rooms plain, and no lobby or lead', () => {
    const signs = officeSigns(layout);
    const departments = signs.filter((s) => s.department !== null);
    expect(departments.map((s) => s.room)).toEqual(layout.rooms.map((r) => r.id));
    expect(departments.every((s) => s.department === layout.rooms.find((r) => r.id === s.room)?.style)).toBe(true);
    expect(signs.filter((s) => s.department === null).map((s) => s.name)).toEqual(["CEO's office", 'Reception', 'Meeting room', 'Kitchen']);
    expect(signs.map((s) => s.id)).not.toContain('room:lobby');
    expect(signs.map((s) => s.id)).not.toContain('room:lead');
    expect(new Set(signs.map((s) => s.id)).size).toBe(signs.length);
    for (const s of signs) expect(s.id).toBe(`room:${s.room}`);
  });

  it('finds an anchor the scenery registers for every sign, and the screen corners when there is a meeting room', () => {
    const plan = planOffice(layout, { theme: 'cafe', decor: [] });
    const anchors = new Set(plan?.anchors.map((a) => a.id));
    for (const s of officeSigns(layout)) expect(anchors.has(s.id), s.id).toBe(true);
    for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) expect(anchors.has(`screen:${corner}`)).toBe(true);
  });

  it('leaves an office that only watches to v2', () => {
    expect(officeSigns(computeLayout(null))).toEqual([]);
  });
});

describe('what a waiter and the front desk open', () => {
  it('opens the inbox on an item, and the proposal for the CEO', () => {
    expect(itemPath('q-3')).toBe('inbox/q-3');
    expect(itemPath('a-1')).toBe('inbox/a-1');
    expect(itemPath('q 1/2')).toBe('inbox/q%201%2F2');
    expect(itemPath('proposal')).toBe('proposal');
  });

  it("gives each person their oldest question or approval still waiting, until an answer applies", () => {
    const view = cafe({
      approvals: [approval('a-2', 'frontend-engineer', 30), approval('a-9', 'frontend-engineer', 5, { withdrawn: { reason: 'timed out', at: at(20) } })],
      questions: [question('q-1', 'frontend-engineer', 12), question('q-4', 'ui-designer', 2, { answer: { option: 0, text: 'TWINT', at: at(40), appliesAt: at(40) + UNDO_MS } })],
    });
    expect(itemOf(view, 'frontend-engineer', at(50))).toBe('q-1');
    // Answered, with Undo still open: their paper is still theirs to open.
    expect(itemOf(view, 'ui-designer', at(41))).toBe('q-4');
    expect(itemOf(view, 'ui-designer', at(40) + UNDO_MS)).toBeNull();
    expect(itemOf(view, 'copywriter', at(50))).toBeNull();
  });

  it("gives the CEO the proposal while it waits for your OK", () => {
    const proposed = cafe({ phase: 'proposed', proposal: demoProposal() });
    expect(itemOf(proposed, 'ceo', at(10))).toBe('proposal');
    expect(itemOf(proposed, 'head-of-design', at(10))).toBeNull();
    // Once the company runs, the proposal it kept waits on nobody.
    expect(itemOf(cafe({ proposal: demoProposal() }), 'ceo', at(10))).toBeNull();
  });

  it('counts everyone in line, as the moments do, and opens the oldest', () => {
    const ids = ['frontend-engineer', 'ui-designer', 'copywriter', 'qa-engineer', 'ux-designer', 'backend-engineer', 'devops-engineer'];
    const view = cafe({ questions: ids.map((id, i) => question(`q-${i}`, id, 1 + i)) });
    const cast = watched(view, 10);
    expect(cast.moments?.frontDesk).toHaveLength(7);
    const sign = frontDeskSign(cast.members);
    expect(sign).toEqual({ waiting: 7, text: 'Front desk, 7 need you', opens: 'inbox/q-0' });
    // The seventh, at their own desk with the paper raised, opens theirs too.
    expect(byPerson(cast, 'devops-engineer')).toMatchObject({ inLine: 6, item: 'q-6' });
  });

  it('says one person needs you, and opens the CEO with the proposal', () => {
    const one = watched(cafe({ approvals: [approval('a-1', 'frontend-engineer', 3)] }), 10);
    expect(frontDeskSign(one.members)).toEqual({ waiting: 1, text: 'Front desk, 1 needs you', opens: 'inbox/a-1' });
    expect(byPerson(one, 'frontend-engineer').item).toBe('a-1');
    expect(byPerson(one, 'ui-designer')).toMatchObject({ inLine: null, item: null });

    const proposed = watched(cafe({ phase: 'proposed', proposal: demoProposal() }), 10);
    expect(frontDeskSign(proposed.members)?.opens).toBe('proposal');
  });

  it('has no sign while nobody waits', () => {
    expect(frontDeskSign(watched(cafe(), 10).members)).toBeNull();
  });

  it("matches the demo company's line", () => {
    const now = at(0);
    const view = demoCompanyView(now);
    const layout = computeLayout(studioOf(view));
    const seen = new SeenLog();
    const snapshot = demoSnapshot(view, 'C:\\cafe', now);
    seen.note(snapshot, layout);
    const cast = castFrom(snapshot, layout, { now: now + 60_000, seen });
    const line = cast.moments?.frontDesk ?? [];
    expect(line.length).toBeGreaterThan(0);
    const sign = frontDeskSign(cast.members);
    expect(sign?.waiting).toBe(line.length);
    const first = cast.members.find((m) => m.person === line[0]);
    expect(sign?.opens).toBe(itemPath(first?.item ?? ''));
  });
});

describe('the line over the door at night', () => {
  const until = Date.UTC(2026, 10, 5, 14, 0, 0);

  it('says what the top bar says while the company rests on a usage limit or an overload', () => {
    for (const reason of ['usage-limit', 'overloaded'] as const) {
      const view = cafe({ pause: { reason, since: at(0), until, message: 'Limit reached' } });
      expect(nightLine(view, utc)).toBe('Resting until 14:00');
      expect(nightLine(view, utc)).toBe(companyState(stateOfCompany(view, at(600)), at(600), utc).pill);
    }
    expect(nightLine(cafe({ pause: { reason: 'usage-limit', since: at(0), until: null, message: '' } }), utc)).toBe('Resting');
  });

  it('is not there by day, or while you paused work yourself', () => {
    expect(nightLine(cafe(), utc)).toBeNull();
    expect(nightLine(cafe({ pause: { reason: 'stakeholder', since: at(0), until: null, message: 'You paused work.' } }), utc)).toBeNull();
  });
});

describe('the office screen', () => {
  const free = { left: 12, top: 72, right: 1428, bottom: 888 };
  const face = (x: number, y: number, w: number, h: number, skew = 0): ScreenCorners => ({
    topLeft: { x, y }, topRight: { x: x + w, y: y + skew }, bottomRight: { x: x + w, y: y + h + skew }, bottomLeft: { x, y: y + h },
  });

  it('runs the app live on a desktop when the whole screen is on camera and big enough to read', () => {
    expect(screenLive(face(400, 300, LIVE_SCREEN_MIN_PX, 140), free, false)).toBe(true);
    expect(screenLive(face(400, 300, 260, 150, -40), free, false)).toBe(true);
  });

  it('shows the latest screenshot when it is small, partly off camera, under the HUD, or on a phone', () => {
    expect(screenLive(face(400, 300, LIVE_SCREEN_MIN_PX - 1, 140), free, false)).toBe(false);
    expect(screenLive(face(1300, 300, 300, 160), free, false)).toBe(false);
    expect(screenLive(face(400, 40, 300, 160), free, false)).toBe(false);
    expect(screenLive(face(400, 300, 600, 320), free, true)).toBe(false);
  });

  it('hides from a camera that has orbited round behind its face', () => {
    expect(facesCamera(face(400, 300, 260, 150, -40))).toBe(true);
    const mirrored = face(400, 300, 260, 150, -40);
    expect(facesCamera({ topLeft: mirrored.topRight, topRight: mirrored.topLeft, bottomLeft: mirrored.bottomRight })).toBe(false);
    expect(facesCamera(face(400, 300, 0, 150))).toBe(false);
  });

  it('takes a press inside its face as drawn, skewed by the camera, and nowhere else', () => {
    const skewed = face(100, 100, 60, 40, -30);
    expect(onScreen({ x: 130, y: 105 }, skewed)).toBe(true);
    expect(onScreen({ x: 158, y: 75 }, skewed)).toBe(true);
    // Inside the bounding box but above the slanted top edge.
    expect(onScreen({ x: 110, y: 75 }, skewed)).toBe(false);
    expect(onScreen({ x: 200, y: 105 }, skewed)).toBe(false);
    expect(onScreen({ x: 130, y: 105 }, face(130, 105, 0, 0))).toBe(false);
  });
});

describe('fixed labels', () => {
  const box = (id: string, kind: LabelBox['kind'], x: number, y: number, w: number, h: number, hang: LabelBox['hang'] = 'above', rank = 0): LabelBox => ({
    id, kind, x, y, w, h, hang, rank, depth: 0,
  });

  it('hang the front desk sign below its anchor, and move bubbles above it rather than over it', () => {
    // The sign's top at 300; a bubble whose person stands just in front would end at 310.
    const { lifts, dropped, covered } = stackLabels([box('desk:front', 'fixed', 500, 300, 180, 32, 'below'), box('person:kai', 'person', 520, 310, 160, 26, 'above', 2)]);
    expect(lifts.get('person:kai')).toBe(14);
    expect(lifts.get('desk:front')).toBe(0);
    expect(dropped.size).toBe(0);
    expect(covered.size).toBe(0);
  });

  it('move the night line up clear of the front desk sign where they meet, whichever comes first', () => {
    const sign = box('desk:front', 'fixed', 300, 500, 160, 32, 'below', 1);
    const night = box('door:night', 'fixed', 400, 520, 160, 24);
    for (const labels of [[sign, night], [night, sign]]) {
      const { lifts, dropped } = stackLabels(labels);
      expect(lifts.get('desk:front')).toBe(0);
      // Its foot rises to 4 px above the sign's top (500): from 520 to 496.
      expect(lifts.get('door:night')).toBe(24);
      expect(dropped.size).toBe(0);
    }
  });

  it('never hide, and a gate caption moves clear of them too', () => {
    const labels = [box('door:night', 'fixed', 800, 200, 170, 26), box('gate:review', 'gate', 800, 210, 120, 30)];
    const { lifts, dropped, covered } = stackLabels(labels, { ceiling: 0, maxStack: 1 });
    // Its foot rises to 4 px above the line's top (174): from 210 to 170.
    expect(lifts.get('gate:review')).toBe(40);
    expect(dropped.has('door:night')).toBe(false);
    expect(covered.has('door:night')).toBe(false);
  });

  it('hide a room sign they meet rather than show a fragment of it', () => {
    const labels = [box('room:meeting', 'sign', 380, 500, 120, 28, 'above-right'), box('door:night', 'fixed', 400, 520, 160, 24), box('room:kitchen', 'sign', 700, 500, 90, 28, 'above-right')];
    const { covered, lifts } = stackLabels(labels);
    expect([...covered]).toEqual(['room:meeting']);
    expect(lifts.get('door:night')).toBe(0);
  });

  it('leave a bubble alone that is clear of them', () => {
    const { lifts } = stackLabels([box('desk:front', 'fixed', 500, 300, 180, 32, 'below'), box('person:kai', 'person', 500, 296, 160, 26, 'above', 2)]);
    expect(lifts.get('person:kai')).toBe(0);
  });

  it("hold the front desk sign up above a phone's sheet, so it shows whole", () => {
    // The sign hangs from 140 to 184; the sheet's top (less the edge) is at 175.
    const sign = box('desk:front', 'fixed', 190, 140, 166, 44, 'below', 1);
    expect(stackLabels([sign], { floor: 175 }).lifts.get('desk:front')).toBe(9);
    expect(stackLabels([sign], { floor: 200 }).lifts.get('desk:front')).toBe(0);
    // Someone waiting there still moves up clear of it: their bubble's foot ends 4 px above the sign's new top (131).
    const { lifts } = stackLabels([sign, box('person:noor', 'person', 190, 150, 140, 20, 'above', 2)], { floor: 175 });
    expect(lifts.get('person:noor')).toBe(23);
  });

  it('lift the front desk sign by its own height at most, so it never floats away from the counter', () => {
    // The counter itself is 80 px under the foot (panned away): the sign rises 44 px, its own height, and no further.
    const sign = box('desk:front', 'fixed', 190, 140, 166, 44, 'below', 1);
    expect(stackLabels([sign], { floor: 100 }).lifts.get('desk:front')).toBe(44);
  });
});

describe('labels that meet', () => {
  const box = (id: string, kind: LabelBox['kind'], x: number, y: number, w: number, h: number, hang: LabelBox['hang'] = 'above', rank = 0, depth = 0): LabelBox => ({
    id, kind, x, y, w, h, hang, rank, depth,
  });
  // A phone's room sign: 84 by 22, its words inset by its padding and coloured edge.
  const reception = box('room:reception', 'sign', 300, 200, 84, 22, 'above-right');

  it('hide a room sign whose words a bubble covers, even at their very end', () => {
    // A stuck person's bubble over the sign's last 19 px: it read "Receptio" before.
    const stuck = box('person:sam', 'person', 420, 205, 110, 20, 'above', 1);
    expect(stackLabels([reception, stuck]).covered).toEqual(new Set(['room:reception']));
  });

  it("leave a room sign showing when a bubble only touches its edge, past its words", () => {
    const grazing = box('person:sam', 'person', 435, 205, 110, 20, 'above', 1);
    expect(stackLabels([reception, grazing]).covered.size).toBe(0);
  });

  it('hide the farther of two room signs that meet, and keep it when the nearer one hides', () => {
    // Engineering hangs lower on screen (nearer the camera) than Security, and their corners meet.
    const engineering = box('room:engineering', 'sign', 100, 300, 95, 22, 'above-right');
    const security = box('room:security', 'sign', 180, 290, 70, 22, 'above-right');
    expect(stackLabels([security, engineering]).covered).toEqual(new Set(['room:security']));
    // A bubble over Engineering's words hides it; Security then has nothing to give way to.
    const over = box('person:ben', 'person', 125, 300, 90, 22, 'above', 0);
    expect(stackLabels([security, engineering, over]).covered).toEqual(new Set(['room:engineering']));
  });

  it('on a desktop, drop routine bubbles past four in a stack, never someone who needs you, is stuck or asks', () => {
    // Eight people close together: one needs you, four are stuck or ask, three are at work; nearest first.
    const ranks = [2, 1, 1, 1, 1, 0, 0, 0];
    const labels = ranks.map((rank, i) => box(`person:${i}`, 'person', 500 + i * 4, 300, 160, 26, 'above', rank, 10 - i));
    const desktop = stackLabels(labels, { maxStack: 4, exempt: 1 });
    expect(desktop.dropped).toEqual(new Set(['person:5', 'person:6', 'person:7']));
    // The fifth one who is stuck shows above the four under it.
    expect(desktop.lifts.get('person:4')).toBe(120);
    // Without the exemption, as on a phone, the least important drop first whatever they say.
    expect(stackLabels(labels, { maxStack: 3 }).dropped).toEqual(new Set(['person:3', 'person:4', 'person:5', 'person:6', 'person:7']));
  });

  it("on a phone, stack two waiters' bubbles far enough apart that their targets never meet", () => {
    // Phone bubbles are 21 px; as buttons they reach 1.5 px past their box above and below, a 24 px target (labels.css).
    const reach = 1.5;
    const near = box('person:noor', 'person', 200, 300, 140, 21, 'above', 2, 2);
    const far = box('person:kai', 'person', 210, 300, 140, 21, 'above', 2, 1);
    const { lifts, dropped } = stackLabels([near, far], { maxStack: 3 });
    expect(dropped.size).toBe(0);
    expect(lifts.get('person:noor')).toBe(0);
    const upperFoot = 300 - (lifts.get('person:kai') ?? 0) + reach;
    const lowerTop = 300 - 21 - reach;
    expect(upperFoot).toBeLessThan(lowerTop);
  });

  it('on a desktop, keep a stack of four people at work whole and drop the farther ones past it', () => {
    const labels = [0, 1, 2, 3, 4, 5].map((i) => box(`person:${i}`, 'person', 500 + i * 4, 300, 160, 26, 'above', 0, 10 - i));
    expect(stackLabels(labels, { maxStack: 4, exempt: 1 }).dropped).toEqual(new Set(['person:4', 'person:5']));
  });
});

describe('quiet labels', () => {
  it('keep only the bubbles of people who need you, are stuck or ask, and always the person picked', () => {
    // Progress beside the office, or a phone's thumbnail: quiet.
    expect(bubbleShown('needs-you', true, false)).toBe(true);
    expect(bubbleShown('stuck', true, false)).toBe(true);
    expect(bubbleShown('question', true, false)).toBe(true);
    for (const tone of ['answering', 'report', 'on-it', 'meeting'] as const) {
      expect(bubbleShown(tone, true, false)).toBe(false);
      expect(bubbleShown(tone, true, true)).toBe(true);
      // The office on its own shows every bubble.
      expect(bubbleShown(tone, false, false)).toBe(true);
    }
  });
});
