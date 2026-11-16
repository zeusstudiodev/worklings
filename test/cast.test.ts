import { describe, expect, it } from 'vitest';
import type { OfficeEvent } from '../src/core/events.ts';
import { apply, emptyOffice, indexStudio, MEETING_MS, type OfficeState } from '../src/core/office.ts';
import type { ReplayInfo } from '../src/core/snapshot.ts';
import type { Studio } from '../src/core/studio.ts';
import {
  BUBBLE_CHARS,
  BUBBLE_CHARS_NARROW,
  type Cast,
  type CastMember,
  castFrom,
  type CastOptions,
  clockRate,
  cut,
  meetingSpot,
  placeOn,
  SceneClock,
  type SceneSnapshot,
  SeenLog,
  STAND_MS,
} from '../web/src/scene/cast.ts';
import { computeLayout, deskRects, type Point, type Rect, seatOf, wallRects } from '../web/src/scene/layout.ts';
import { stackLabels } from '../web/src/scene/stack.ts';
import { pathLength, route, WALK_MAX_MS, WALK_MIN_MS } from '../web/src/scene/walk.ts';

const studio: Studio = {
  version: 1, name: 'Plant Pal', domain: 'mobile-app', rigor: 'standard',
  departments: [
    { id: 'design', name: 'Design', style: 'design' },
    { id: 'engineering', name: 'Engineering', style: 'engineering' },
    { id: 'quality', name: 'Quality', style: 'quality' },
  ],
  roles: [
    { id: 'ux-designer', department: 'design', title: 'UX designer' },
    { id: 'ui-designer', department: 'design', title: 'UI designer' },
    { id: 'mobile-engineer', department: 'engineering', title: 'Mobile engineer' },
    { id: 'backend-engineer', department: 'engineering', title: 'Backend engineer' },
    { id: 'frontend-engineer', department: 'engineering', title: 'Frontend engineer' },
    { id: 'qa-engineer', department: 'quality', title: 'QA engineer' },
  ],
  rules: [], gates: [], skills: [], fired: [],
};
const layout = computeLayout(studio);
const index = indexStudio(studio);

type Event = OfficeEvent extends infer E ? (E extends OfficeEvent ? Omit<E, 'sessionId'> : never) : never;
const T0 = Date.UTC(2026, 10, 4, 9, 0, 0);
/** Seconds into the session, on the snapshot clock. */
const at = (seconds: number) => T0 + Math.round(seconds * 1000);

const REQUEST = 'Add a watering streak to the home screen, with a small celebration at 7 days';
const prompt = (t: number, text = REQUEST): Event => ({ kind: 'prompt', at: at(t), text, notification: false });
const brief = (t: number, agentId: string, agentType: string, task: string): Event[] => [
  { kind: 'tool-start', at: at(t), toolUseId: `spawn-${agentId}`, tool: 'Agent', target: `${agentType}: ${task}`, spawn: { agentType, description: task } },
  { kind: 'subagent-start', at: at(t), agentId, agentType },
];
const tool = (t: number, agentId: string | null, name: string, target: string): Event =>
  agentId ? { kind: 'tool-start', at: at(t), toolUseId: `${agentId}-${t}`, tool: name, target, agentId } : { kind: 'tool-start', at: at(t), toolUseId: `lead-${t}`, tool: name, target };
const toolEnd = (t: number, agentId: string | null, name: string, started: number, error?: string): Event => ({
  kind: 'tool-end', at: at(t), toolUseId: `${agentId ?? 'lead'}-${started}`, tool: name, ok: !error, ...(error ? { error } : {}), ...(agentId ? { agentId } : {}),
});
const reportsBack = (t: number, agentId: string, agentType: string, lastMessage: string, question?: string): Event => ({
  kind: 'subagent-stop', at: at(t), agentId, agentType, lastMessage, ...(question ? { question } : {}),
});

function office(...events: (Event | Event[])[]): OfficeState {
  const state = emptyOffice();
  for (const e of events.flat()) apply(state, { sessionId: 's', ...e } as OfficeEvent, index);
  return state;
}

function add(state: OfficeState, ...events: (Event | Event[])[]) {
  for (const e of events.flat()) apply(state, { sessionId: 's', ...e } as OfficeEvent, index);
}

function scene(state: OfficeState, t: number, replay: ReplayInfo | null = null): SceneSnapshot {
  return { agents: Object.values(state.agents).sort((a, b) => a.startedAt - b.startedAt), studio, serverTime: at(t), replay };
}

/** The cast as a browser that has watched since `seenAt` sees it at `t`. */
function watch(state: OfficeState, t: number, options: CastOptions = {}): Cast {
  const seen = new SeenLog();
  seen.note(scene(state, t));
  return castFrom(scene(state, t), layout, { seen, ...options });
}

function person(cast: Cast, key: string): CastMember {
  const found = cast.members.find((m) => m.key === key);
  if (!found) throw new Error(`No ${key} among ${cast.members.map((m) => m.key).join(', ')}`);
  return found;
}

const replayAt = (t: number, speed: number, playing = true): ReplayInfo => ({ sessionId: 's', title: 'Build', startedAt: at(0), endedAt: at(600), position: at(t), speed, playing });
const seat = (roleId: string) => seatOf(layout.desks.get(roleId) ?? { x: Number.NaN, z: Number.NaN });
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;
const insideRect = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d;
const roomOf = (id: string) => layout.rooms.find((r) => r.id === id) ?? { x: 0, z: 0, w: 0, d: 0 };

describe('bubbles', () => {
  it('say the goal in a few words after a dot that pulses only while a step runs', () => {
    const state = office(prompt(0), brief(1, 'ux', 'ux-designer', 'Design the streak card and the 7-day celebration'));
    expect(person(watch(state, 10), 'desk:ux-designer').bubble).toEqual({ tone: 'on-it', lead: null, text: 'Design the streak card…', dot: 'still' });
    add(state, tool(11, 'ux', 'Read', 'components/PlantCard.tsx'));
    expect(person(watch(state, 12), 'desk:ux-designer').bubble).toMatchObject({ text: 'Design the streak card…', dot: 'busy' });
    // The lead's goal is your request.
    expect(person(watch(state, 12), 'lead').bubble).toMatchObject({ tone: 'on-it', text: 'Add a watering streak…' });
  });

  it('say "On it" when the goal is unknown', () => {
    const state = office(prompt(0), { kind: 'subagent-start', at: at(1), agentId: 'qa', agentType: 'qa-engineer' });
    expect(person(watch(state, 10), 'desk:qa-engineer').bubble).toEqual({ tone: 'on-it', lead: null, text: 'On it', dot: 'still' });
  });

  it('ask for your OK in yellow, naming what for, cut at a word to fit a phone too', () => {
    const state = office(prompt(0), brief(1, 'm', 'mobile-engineer', 'Build the streak card'));
    add(state, { kind: 'permission', at: at(20), agentId: 'm', tool: 'Bash', target: 'npx expo install expo-haptics' });
    expect(person(watch(state, 21), 'desk:mobile-engineer').bubble).toEqual({ tone: 'needs-you', lead: null, text: 'Needs your OK to run npx…', dot: null });
    expect(person(watch(state, 21, { narrow: true }), 'desk:mobile-engineer').bubble?.text).toBe('Needs your OK to run…');
  });

  it('ask you in yellow while a question to you is open', () => {
    const state = office(prompt(0), { kind: 'tool-start', at: at(2), toolUseId: 'q', tool: 'AskUserQuestion', target: 'asking you', ask: 'Which chart library should I use?' });
    expect(person(watch(state, 3), 'lead').bubble).toEqual({ tone: 'needs-you', lead: 'Asks you:', text: 'Which chart…', dot: null });
    const notice = office(prompt(0), { kind: 'notice', at: at(2), message: 'Claude needs your input', needsYou: true });
    expect(person(watch(notice, 3), 'lead').bubble).toEqual({ tone: 'needs-you', lead: null, text: 'Needs your answer', dot: null });
  });

  it('read an error as on it for 30 s, then as stuck for so long', () => {
    const state = office(prompt(0), tool(10, null, 'Bash', 'npm run typecheck'), toolEnd(12, null, 'Bash', 10, 'Exit code 2'));
    const early = watch(state, 30);
    expect(person(early, 'lead').bubble?.tone).toBe('on-it');
    expect(early.nextChangeAt).toBe(at(42));
    expect(person(watch(state, 43), 'lead').bubble).toEqual({ tone: 'stuck', lead: null, text: 'Stuck for under a minute', dot: null });
    expect(person(watch(state, 12 + 185), 'lead').bubble?.text).toBe('Stuck for 3 min');
  });

  it('carry a question: the lead asks you, a subagent asks the lead', () => {
    const lead = office(prompt(0), { kind: 'turn-end', at: at(30), failed: false, lastMessage: 'Done. Want me to run the end-to-end suite too?', question: 'Want me to run the end-to-end suite too?' });
    expect(person(watch(lead, 31), 'lead').bubble).toEqual({ tone: 'question', lead: 'Asks you:', text: 'Want me to run…', dot: null });
    const sub = office(prompt(0), brief(1, 'qa', 'qa-engineer', 'Test the streak'), reportsBack(40, 'qa', 'qa-engineer', 'Two tests fail on a slow phone. Should it repeat them?', 'Should it repeat them?'));
    // The report shows at the desk first; the question stands after it.
    expect(person(watch(sub, 41, { reducedMotion: true }), 'desk:qa-engineer').bubble).toMatchObject({ tone: 'report', text: 'Two tests fail on a slow…' });
    expect(person(watch(sub, 49, { reducedMotion: true }), 'desk:qa-engineer').bubble).toEqual({ tone: 'question', lead: 'Asks the lead:', text: 'Should it…', dot: null });
  });

  it("show the lead's finished turn after a check mark until your next message", () => {
    const state = office(prompt(0), { kind: 'turn-end', at: at(118), failed: false, lastMessage: '## Summary\n\nThe **streak card** is in. It passed every gate.' });
    expect(person(watch(state, 400), 'lead').bubble).toEqual({ tone: 'report', lead: null, text: 'The streak card is in.', dot: 'check' });
    add(state, prompt(500, 'Now add a weekly summary card under it'));
    expect(person(watch(state, 501), 'lead').bubble).toMatchObject({ tone: 'on-it', text: 'Now add a weekly summary…' });
  });

  it('start a report with a capital, whatever the agent wrote', () => {
    const state = office(prompt(0), { kind: 'turn-end', at: at(30), failed: false, lastMessage: 'finished' });
    expect(person(watch(state, 31), 'lead').bubble).toEqual({ tone: 'report', lead: null, text: 'Finished', dot: 'check' });
  });

  it('leave people off duty without one', () => {
    const state = office(prompt(0));
    expect(person(watch(state, 5), 'desk:ui-designer').bubble).toBeNull();
  });
});

describe('cut', () => {
  it('keeps one line to about 28 characters, 22 on phones, and never ends on a little word', () => {
    expect(cut('Design the streak card and the 7-day celebration', 26)).toBe('Design the streak card…');
    expect(cut('Check the streak spec against the design system', BUBBLE_CHARS)).toBe('Check the streak spec…');
    expect(cut('Check the streak spec against the design system', BUBBLE_CHARS_NARROW)).toBe('Check the streak spec…');
    expect(cut('Plan the importer', BUBBLE_CHARS)).toBe('Plan the importer');
    expect(cut('  Plan\nthe   importer  ', BUBBLE_CHARS)).toBe('Plan the importer');
  });

  it('cuts a long path or command where it must rather than dropping it', () => {
    expect(cut('Reads web/src/hud/ActivityLog.tsx closely', BUBBLE_CHARS)).toBe('Reads web/src/hud/ActivityL…');
    expect(cut('Spec in docs/streak-card.md: flame icon, day count', BUBBLE_CHARS)).toBe('Spec in docs/streak-card.md…');
  });
});

describe('meetings', () => {
  it('a brief brings the subagent from its desk to the lead and back, in under 6.5 s', () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'));
    const seen = new SeenLog();
    seen.note(scene(state, 5));
    const cast = (t: number) => castFrom(scene(state, 5), layout, { seen, now: at(t) });
    const ux = person(cast(5), 'desk:ux-designer');
    const [there, back] = ux.walk;
    if (!there || !back) throw new Error('no walk');
    const spot = meetingSpot(layout, 0);
    expect(there.at).toBe(at(5));
    expect(near(there.path[0] ?? spot, seat('ux-designer'))).toBe(true);
    expect(near(there.path[there.path.length - 1] ?? seat('ux-designer'), spot)).toBe(true);
    expect(near(back.path[back.path.length - 1] ?? spot, seat('ux-designer'))).toBe(true);
    for (const leg of [there, back]) {
      expect(leg.ms).toBeGreaterThanOrEqual(WALK_MIN_MS);
      expect(leg.ms).toBeLessThanOrEqual(WALK_MAX_MS);
    }
    expect(back.at).toBe(there.at + there.ms + STAND_MS);
    expect(back.at + back.ms - at(5)).toBeLessThanOrEqual(MEETING_MS);
    // On the snapshot clock: on the way, standing together, then back at the desk.
    expect(placeOn(ux.walk, seat('ux-designer'), there.at + there.ms / 2)).toMatchObject({ away: true });
    expect(placeOn(ux.walk, seat('ux-designer'), there.at + there.ms / 2).heading).not.toBeNull();
    expect(placeOn(ux.walk, seat('ux-designer'), there.at + there.ms + 100)).toMatchObject({ ...spot, heading: null, away: true });
    expect(placeOn(ux.walk, seat('ux-designer'), back.at + back.ms + 1)).toMatchObject({ ...seat('ux-designer'), away: false });
    // The lead says the goal and turns to face them; the subagent says "On it" and looks at the lead.
    const standing = cast(5 + (there.ms + 100) / 1000);
    expect(person(standing, 'lead').bubble).toEqual({ tone: 'meeting', lead: null, text: 'Design the streak card', dot: null });
    expect(person(standing, 'lead').gaze).toEqual([{ from: there.at + there.ms - 400, until: back.at, toward: spot }]);
    expect(person(standing, 'desk:ux-designer').bubble).toEqual({ tone: 'meeting', lead: null, text: 'On it', dot: null });
    expect(person(standing, 'desk:ux-designer').gaze[0]?.toward).toEqual(seatOf(layout.lead.desk));
    // Back at the desk it is simply on it.
    const after = cast(5 + (back.at + back.ms - at(5) + 10) / 1000);
    expect(person(after, 'desk:ux-designer').walk).toEqual([]);
    expect(person(after, 'desk:ux-designer').bubble).toMatchObject({ tone: 'on-it', text: 'Design the streak card' });
    expect(person(after, 'lead').bubble?.tone).toBe('on-it');
  });

  it("a report brings them over again, saying the report's first sentence through the meeting and 8 s after", () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'), tool(10, 'ux', 'Write', 'docs/streak-card.md'));
    add(state, reportsBack(20, 'ux', 'ux-designer', 'Spec in docs/streak-card.md: flame icon, day count, gentle confetti at 7. Nothing else changed.'));
    const seen = new SeenLog();
    seen.note(scene(state, 20));
    const cast = (t: number) => castFrom(scene(state, 20), layout, { seen, now: at(t) });
    const ux = person(cast(20), 'desk:ux-designer');
    const [there, back] = ux.walk;
    if (!there || !back) throw new Error('no walk');
    expect(near(there.path[0] ?? meetingSpot(layout, 0), seat('ux-designer'))).toBe(true);
    expect(ux).toMatchObject({ status: 'done', meeting: true, bubble: { tone: 'report', text: 'Spec in docs/streak-card.md…' } });
    const done = back.at + back.ms;
    expect(person(cast(20 + (done - at(20) + 7900) / 1000), 'desk:ux-designer').bubble?.tone).toBe('report');
    expect(person(cast(20 + (done - at(20) + 8100) / 1000), 'desk:ux-designer').bubble).toBeNull();
    // The lead keeps its own bubble during a report.
    expect(person(cast(21), 'lead').bubble?.tone).toBe('on-it');
  });

  it('a role the lead continues with SendMessage walks over to be briefed again', () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'), reportsBack(20, 'ux', 'ux-designer', 'Spec in docs/streak.md.'));
    add(state, { kind: 'tool-start', at: at(60), toolUseId: 'send-ux', tool: 'SendMessage', target: 'ux', brief: { agentId: 'ux', description: 'Add the 7-day celebration' } });
    const seen = new SeenLog();
    seen.note(scene(state, 60));
    const ux = person(castFrom(scene(state, 60), layout, { seen, now: at(60) }), 'desk:ux-designer');
    expect(ux.walk[0]?.at).toBe(at(60));
    expect(near(ux.walk[0]?.path[0] ?? meetingSpot(layout, 0), seat('ux-designer'))).toBe(true);
  });

  it('contractors walk in from the lobby door and leave through it after reporting', () => {
    const state = office(prompt(0), brief(50, 'ex', 'Explore', 'Find where plant data is cached'));
    const arriving = person(watch(state, 50), 's:ex');
    expect(near(arriving.walk[0]?.path[0] ?? seat('qa-engineer'), layout.lobby.entrance)).toBe(true);
    const lobbySeat = { x: arriving.x, z: arriving.z };
    expect(insideRect(lobbySeat, layout.lobby)).toBe(true);
    expect(near(arriving.walk[1]?.path.at(-1) ?? layout.lobby.entrance, lobbySeat)).toBe(true);

    add(state, tool(52, 'ex', 'Grep', 'AsyncStorage'), reportsBack(57, 'ex', 'Explore', 'Plant data is cached in lib/storage.ts under the key "plants:v2".'));
    const seen = new SeenLog();
    seen.note(scene(state, 57));
    const leaving = person(castFrom(scene(state, 57), layout, { seen }), 's:ex');
    const [there, out] = leaving.walk;
    if (!there || !out) throw new Error('no walk');
    expect(near(there.path[0] ?? layout.lobby.entrance, lobbySeat)).toBe(true);
    expect(near(out.path.at(-1) ?? lobbySeat, layout.lobby.entrance)).toBe(true);
    const gone = castFrom(scene(state, 57), layout, { seen, now: out.at + out.ms + 1 });
    expect(gone.members.some((m) => m.key === 's:ex')).toBe(false);
  });

  it('extra copies of a role come in from the lobby door, then stand beside their own desk inside its room, without swapping', () => {
    const state = office(prompt(0), brief(32, 'm1', 'mobile-engineer', 'Build the streak card'), brief(34, 'm2', 'mobile-engineer', 'Wire up the haptics'));
    const second = person(watch(state, 34), 's:m2');
    expect(near(second.walk[0]?.path[0] ?? seat('mobile-engineer'), layout.lobby.entrance)).toBe(true);
    const desk = layout.desks.get('mobile-engineer') ?? { x: 0, z: 0 };
    expect(insideRect(second, roomOf('engineering'))).toBe(true);
    expect(Math.hypot(second.x - desk.x, second.z - desk.z)).toBeLessThan(2);
    // No one stands on a desk.
    for (const r of deskRects(layout)) expect(insideRect(second, r)).toBe(false);

    // The two take turns with their tools; who sits and who stands stays the same.
    for (let t = 40; t < 60; t += 2) add(state, tool(t, t % 4 === 0 ? 'm1' : 'm2', 'Read', `file-${t}.ts`));
    for (const t of [52, 55, 58]) {
      const cast = watch(state, t);
      expect(person(cast, 'desk:mobile-engineer').agentKey).toBe('s:m1');
      expect(person(cast, 's:m2')).toMatchObject({ x: second.x, z: second.z, walk: [] });
    }
  });

  it('up to four meet in an arc in front of the desk; a fifth is briefed by bubble alone', () => {
    const roles = ['ux-designer', 'ui-designer', 'mobile-engineer', 'backend-engineer', 'qa-engineer'];
    const state = office(prompt(0), ...roles.map((r, i) => brief(10, `a${i + 1}`, r, `Goal number ${i + 1}`)));
    const cast = watch(state, 10);
    const walkers = roles.map((r) => person(cast, `desk:${r}`)).filter((m) => m.walk.length > 0);
    expect(walkers).toHaveLength(4);
    expect(person(cast, 'desk:qa-engineer').walk).toEqual([]);
    const spots = walkers.map((m) => m.walk[0]?.path.at(-1) ?? { x: 0, z: 0 });
    expect(new Set(spots.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(4);
    for (const spot of spots) {
      expect(spot.z).toBeGreaterThan(layout.lead.desk.z);
      expect(insideRect(spot, layout.lead)).toBe(true);
    }
    expect(person(cast, 'lead').bubble).toEqual({ tone: 'meeting', lead: null, text: 'Briefs five people', dot: null });
    // With several briefed at once, each shows its own goal.
    expect(person(cast, 'desk:ux-designer').bubble).toMatchObject({ tone: 'on-it', text: 'Goal number 1' });
    // The fifth still counts while the other four stand at the desk, after its own 2.5 s are up.
    const seen = new SeenLog();
    seen.note(scene(state, 10));
    const firstBack = Math.min(...walkers.map((m) => m.walk[1]?.at ?? Number.POSITIVE_INFINITY));
    expect(firstBack).toBeGreaterThan(at(10) + STAND_MS + 100);
    const later = castFrom(scene(state, 10), layout, { seen, now: at(10) + STAND_MS + 100 });
    expect(person(later, 'lead').bubble?.text).toBe('Briefs five people');
  });

  it("on a phone, show only the lead's bubble while people stand together at its desk", () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'));
    const seen = new SeenLog();
    seen.note(scene(state, 5));
    const arrived = person(castFrom(scene(state, 5), layout, { seen }), 'desk:ux-designer').walk[0];
    if (!arrived) throw new Error('no walk');
    const meeting = castFrom(scene(state, 5), layout, { seen, narrow: true, now: arrived.at + arrived.ms + 100 });
    expect(person(meeting, 'desk:ux-designer').bubble).toBeNull();
    expect(person(meeting, 'lead').bubble?.tone).toBe('meeting');
    // On the way over the visitor still speaks, and on a desktop both do.
    expect(person(castFrom(scene(state, 5), layout, { seen, narrow: true, now: arrived.at + arrived.ms / 2 }), 'desk:ux-designer').bubble?.text).toBe('On it');
    expect(person(castFrom(scene(state, 5), layout, { seen, now: arrived.at + arrived.ms + 100 }), 'desk:ux-designer').bubble?.text).toBe('On it');
  });

  it('nobody walks with reduced motion, and bubbles carry it: the brief for 2.5 s, the report for 8 s', () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'));
    const still = watch(state, 5, { reducedMotion: true });
    expect(still.members.every((m) => m.walk.length === 0)).toBe(true);
    expect(person(still, 'lead').bubble?.text).toBe('Design the streak card');
    expect(person(watch(state, 7.4, { reducedMotion: true }), 'lead').bubble?.text).toBe('Design the streak card');
    expect(person(watch(state, 7.6, { reducedMotion: true }), 'lead').bubble?.tone).toBe('on-it');
    add(state, reportsBack(20, 'ux', 'ux-designer', 'Spec is in docs.'));
    expect(person(watch(state, 27.9, { reducedMotion: true }), 'desk:ux-designer')).toMatchObject({ walk: [], bubble: { tone: 'report', text: 'Spec is in docs.' } });
    expect(person(watch(state, 28.1, { reducedMotion: true }), 'desk:ux-designer').bubble).toBeNull();
  });

  it('nobody walks in replays faster than 4x', () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'));
    const at4 = castFrom(scene(state, 6, replayAt(6, 4)), layout);
    const at8 = castFrom(scene(state, 6, replayAt(6, 8)), layout);
    expect(person(at4, 'desk:ux-designer').walk).toHaveLength(2);
    expect(person(at8, 'desk:ux-designer').walk).toEqual([]);
    expect(person(at8, 'lead').bubble?.text).toBe('Design the streak card');
  });

  it('nobody walks for a brief or report first seen more than 5 s after it happened', () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design the streak card'));
    const late = new SeenLog();
    late.note(scene(state, 11));
    expect(person(castFrom(scene(state, 11), layout, { seen: late }), 'desk:ux-designer').walk).toEqual([]);
    const prompt4 = new SeenLog();
    prompt4.note(scene(state, 9));
    expect(person(castFrom(scene(state, 9), layout, { seen: prompt4 }), 'desk:ux-designer').walk).toHaveLength(2);
    // Seen on time, it keeps walking in later renders too.
    expect(person(castFrom(scene(state, 9), layout, { seen: prompt4, now: at(10) }), 'desk:ux-designer').walk).toHaveLength(2);
  });

  it('nobody walks for a person with no figure, such as a fifth copy of a role', () => {
    const state = office(prompt(0), ...[0, 10, 20, 30, 40].map((t, i) => brief(t + 1, `m${i + 1}`, 'mobile-engineer', `Part ${i + 1}`)));
    const cast = watch(state, 41);
    expect(cast.members.some((m) => m.agentKey === 's:m5')).toBe(false);
    expect(cast.members.every((m) => m.walk.length === 0)).toBe(true);
    expect(person(cast, 'lead').bubble?.text).toBe('Part 5');
  });

  it('a report while walking back from the brief turns them around from where they are', () => {
    const state = office(prompt(0), brief(5, 'ui', 'ui-designer', 'Check the streak spec'));
    const seen = new SeenLog();
    seen.note(scene(state, 5));
    const before = person(castFrom(scene(state, 5), layout, { seen }), 'desk:ui-designer');
    const back = before.walk[1];
    if (!back) throw new Error('no walk');
    const turn = back.at + back.ms / 2;
    add(state, { kind: 'subagent-stop', at: turn, agentId: 'ui', agentType: 'ui-designer', lastMessage: 'Passes: it uses the existing icon.' });
    seen.note({ ...scene(state, 0), serverTime: turn });
    const after = person(castFrom({ ...scene(state, 0), serverTime: turn }, layout, { seen }), 'desk:ui-designer');
    const home = seat('ui-designer');
    const where = placeOn(before.walk, home, turn);
    expect(after.walk[0]?.at).toBe(turn);
    expect(near(placeOn(after.walk, home, turn), where)).toBe(true);
    // Heading back to the same spot, then home.
    expect(near(after.walk[0]?.path.at(-1) ?? home, meetingSpot(layout, 0))).toBe(true);
    expect(near(after.walk[1]?.path.at(-1) ?? meetingSpot(layout, 0), home)).toBe(true);
    expect(after.bubble).toMatchObject({ tone: 'report', text: 'Passes: it uses the existing…' });
  });
});

describe('walks', () => {
  /** Points every 5 cm along a path. */
  function samples(path: Point[]): Point[] {
    const out: Point[] = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (!a || !b) continue;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
      for (let s = 0; s <= steps; s++) out.push({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
    }
    return out;
  }

  it('go through doors, never through walls or desks', () => {
    const walls = [...layout.rooms, layout.lobby, layout.lead].flatMap(wallRects);
    const desks = deskRects(layout);
    const starts = [...[...layout.desks.keys()].map(seat), layout.lobby.entrance, ...layout.lobby.seats.slice(0, 3)];
    for (const from of starts) {
      for (let slot = 0; slot < 4; slot++) {
        const path = route(layout, from, meetingSpot(layout, slot));
        expect(path).not.toBeNull();
        for (const p of samples(path ?? [])) {
          for (const w of walls) expect(insideRect(p, w), `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) in a wall`).toBe(false);
          for (const d of desks) expect(insideRect(p, d), `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) on a desk`).toBe(false);
        }
        expect(pathLength(path ?? [])).toBeGreaterThan(0);
      }
    }
  });
});

describe('the scene clock', () => {
  it('runs in real time live, at the replay speed while it plays, and stands still when paused', () => {
    const state = office(prompt(0));
    const clock = new SceneClock();
    clock.sync(scene(state, 10), 1000);
    expect(clock.now(3000)).toBe(at(12));
    clock.sync(scene(state, 10, replayAt(10, 2)), 1000);
    expect(clock.now(3000)).toBe(at(14));
    clock.sync(scene(state, 10, replayAt(10, 2, false)), 1000);
    expect(clock.now(3000)).toBe(at(10));
    expect(clockRate(scene(state, 10, replayAt(10, 2, false)))).toBe(0);
  });

  it('remembers when it first saw each brief, and starts over when a replay jumps back', () => {
    const state = office(prompt(0), brief(5, 'ux', 'ux-designer', 'Design'));
    const ux = state.agents['s:ux'];
    if (!ux) throw new Error('no ux');
    const seen = new SeenLog();
    seen.note(scene(state, 12));
    seen.note(scene(state, 13));
    expect(seen.briefSeen(ux)).toBe(at(12));
    seen.note(scene(state, 6));
    expect(seen.briefSeen(ux)).toBe(at(6));
  });
});

describe('stacked labels', () => {
  const bubble = (id: string, x: number, y: number, depth: number, rank = 0) => ({ id, x, y, w: 160, h: 26, hang: 'above' as const, kind: 'person' as const, rank, depth });
  const sign = (id: string, x: number, y: number) => ({ id, x, y, w: 120, h: 24, hang: 'above-right' as const, kind: 'sign' as const, rank: 0, depth: 0 });
  const gate = (id: string, x: number, y: number) => ({ id, x, y, w: 110, h: 30, hang: 'above' as const, kind: 'gate' as const, rank: 0, depth: 0 });

  it('lift bubbles of people close together above each other instead of covering them', () => {
    const { lifts, dropped } = stackLabels([bubble('person:a', 500, 300, 3), bubble('person:b', 520, 296, 2), bubble('person:c', 480, 292, 1)]);
    // The nearest stays put; the one behind it goes just above it; the third above both.
    expect([lifts.get('person:a'), lifts.get('person:b'), lifts.get('person:c')]).toEqual([0, 26, 52]);
    expect(dropped.size).toBe(0);
    expect(stackLabels([bubble('person:a', 100, 300, 1), bubble('person:b', 400, 300, 2)]).lifts.get('person:a')).toBe(0);
  });

  it('keep someone who needs you where they are', () => {
    const { lifts } = stackLabels([bubble('person:a', 500, 300, 5), bubble('person:b', 510, 302, 1, 2)]);
    expect(lifts.get('person:b')).toBe(0);
    expect(lifts.get('person:a')).toBe(28);
  });

  it("order by where people belong, so someone walking past doesn't trade places on every step", () => {
    // A walker on its way to a meeting near the camera passes above, then below, someone at a desk.
    const above = stackLabels([bubble('person:walker', 500, 280, 9), bubble('person:desk', 500, 300, 4)]).lifts;
    const below = stackLabels([bubble('person:walker', 500, 310, 9), bubble('person:desk', 500, 300, 4)]).lifts;
    expect([above.get('person:walker'), below.get('person:walker')]).toEqual([0, 0]);
    expect(above.get('person:desk')).toBe(50);
    expect(below.get('person:desk')).toBe(20);
  });

  it('move a label near the side of the screen in until it fits, never off its anchor', () => {
    const bounds = { left: 8, right: 367 };
    const shifts = (labels: Parameters<typeof stackLabels>[0]) => stackLabels(labels, { bounds }).shifts;
    // 40 px from the right edge, a 160 px bubble moves 48 px left; 30 px from the left edge, 58 px right.
    expect(shifts([bubble('person:a', 335, 300, 1)]).get('person:a')).toBe(-48);
    expect(shifts([bubble('person:a', 30, 300, 1)]).get('person:a')).toBe(58);
    // Someone off screen keeps 12 px of their bubble over them; one that fits doesn't move.
    expect(shifts([bubble('person:a', 420, 300, 1)]).get('person:a')).toBe(-68);
    expect(shifts([bubble('person:a', 180, 300, 1)]).has('person:a')).toBe(false);
    // A sign hangs to the right of its room's corner, so it only moves left.
    expect(shifts([sign('room:quality', 300, 280)]).get('room:quality')).toBe(-53);
    // Moved in, a bubble now meets its neighbour, and stacks above it.
    expect(stackLabels([bubble('person:a', 335, 300, 1), bubble('person:b', 150, 300, 2)]).lifts.get('person:a')).toBe(0);
    expect(stackLabels([bubble('person:a', 335, 300, 1), bubble('person:b', 150, 300, 2)], { bounds }).lifts.get('person:a')).toBe(30);
  });

  it('hide a room sign a bubble cuts through rather than show a fragment of it', () => {
    // The sign spans 400 to 520 across and 256 to 280 down; the bubble ends at 290, covering two thirds of it.
    expect(stackLabels([sign('room:lead', 400, 280), bubble('person:lead', 460, 290, 1)]).covered).toEqual(new Set(['room:lead']));
    // Over its top 10 px across two thirds of its width: less than a third of it, but its words are cut.
    expect(stackLabels([sign('room:lead', 400, 280), bubble('person:lead', 520, 266, 1)]).covered).toEqual(new Set(['room:lead']));
    // Ten pixels lower it covers only the bottom 6 px, and the sign stays.
    expect(stackLabels([sign('room:lead', 400, 280), bubble('person:lead', 460, 300, 1)]).covered.size).toBe(0);
  });

  it('give way to a yellow bubble wherever it meets a room sign', () => {
    // Over a quarter of the sign, a bubble at work leaves it; one that needs you hides it.
    expect(stackLabels([sign('room:lead', 400, 280), bubble('person:lead', 460, 300, 1)]).covered.size).toBe(0);
    expect(stackLabels([sign('room:lead', 400, 280), bubble('person:lead', 460, 300, 1, 2)]).covered).toEqual(new Set(['room:lead']));
  });

  it("move a running gate's caption clear of a room sign, which never moves, while bubbles pass over signs", () => {
    const labels = [sign('room:content', 400, 280), gate('gate:design-gate', 470, 290), bubble('person:a', 420, 290, 2), bubble('person:b', 470, 255, 1)];
    const { lifts } = stackLabels(labels);
    expect(lifts.has('room:content')).toBe(false);
    expect(lifts.get('gate:design-gate')).toBe(38);
    // A bubble passes over the sign, but keeps clear of the caption.
    expect(lifts.get('person:a')).toBe(0);
    expect(lifts.get('person:b')).toBe(37);
  });

  it('never let a bubble rise under the top bar: the least important drops first', () => {
    const labels = [bubble('person:needs', 500, 120, 1, 2), bubble('person:near', 505, 118, 9), bubble('person:far', 495, 116, 3)];
    const { lifts, dropped } = stackLabels(labels, { ceiling: 64 });
    expect(lifts.get('person:needs')).toBe(0);
    expect(lifts.get('person:near')).toBe(28);
    expect([...dropped]).toEqual(['person:far']);
  });

  it("hold a label down over its person when they stand right under the top bar, rather than lose it", () => {
    const { lifts, dropped } = stackLabels([bubble('person:top', 500, 70, 1, 2)], { ceiling: 64 });
    expect(lifts.get('person:top')).toBe(-20);
    expect(dropped.size).toBe(0);
  });

  it('hold three bubbles at most in one stack on a phone', () => {
    const labels = [0, 1, 2, 3].map((i) => bubble(`person:${i}`, 500 + i * 4, 300, 10 - i));
    expect(stackLabels(labels, { maxStack: 3 }).dropped).toEqual(new Set(['person:3']));
    expect(stackLabels(labels).dropped.size).toBe(0);
  });
});
