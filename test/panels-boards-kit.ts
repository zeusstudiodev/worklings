// Small companies for the Dashboards and Preview models (test/panels-boards-*.test.ts), in the contract's shapes, so a
// change to src/core/company.ts shows up here as a type error.
import { defaultSettings } from '../src/core/company-state.ts';
import type { TimelineEntry } from '../src/core/boards.ts';
import { type CompanyView, DEFAULT_IDLE_MS, DEFAULT_MAX_DESKS, type PersonView } from '../src/core/company.ts';
import type { Dashboard } from '../src/core/dashboard.ts';

/** 14:30 on Thursday 5 November 2026, local time: the moment every test looks from. Clear of any clock change. */
export const NOW = new Date(2026, 10, 5, 14, 30, 0).getTime();
export const min = (n: number) => n * 60_000;
export const hours = (n: number) => n * 3_600_000;
/** A local time on a day in November 2026. */
export const at = (hour: number, minute = 0, day = 5) => new Date(2026, 10, day, hour, minute).getTime();

export function person(id: string, name: string, title: string, room: string, extra: Partial<PersonView> = {}): PersonView {
  return {
    id,
    name,
    title,
    level: 'worker',
    room,
    reportsTo: null,
    look: {},
    model: 'sonnet',
    desk: { person: id, state: 'closed', sessionId: null, since: NOW - min(5), context: null, problem: null, queue: null },
    task: null,
    status: null,
    agentKey: null,
    cost: 0,
    ...extra,
  };
}

export const PEOPLE: PersonView[] = [
  person('ceo', 'Mara', 'CEO', 'direction', { level: 'ceo', model: 'opus' }),
  person('head-of-design', 'Ada', 'Head of design', 'design', { level: 'head', reportsTo: 'ceo' }),
  person('ui-designer', 'Mina', 'UI designer', 'design', { reportsTo: 'head-of-design' }),
  person('frontend-engineer', 'Kai', 'Frontend engineer', 'engineering', { reportsTo: 'ceo' }),
  person('qa-engineer', 'QA engineer', 'QA engineer', 'quality', { reportsTo: 'ceo' }),
];

export const ROOMS = [
  { id: 'direction', name: 'Direction' },
  { id: 'design', name: 'Design' },
  { id: 'engineering', name: 'Engineering' },
  { id: 'quality', name: 'Quality' },
  { id: 'content', name: 'Content' },
];

export function company(extra: Partial<CompanyView> = {}): CompanyView {
  return {
    id: 'cafe-lumen',
    name: 'Café Lumen',
    phase: 'running',
    prompt: 'A bilingual café website with pickup orders',
    stakeholder: 'Robin',
    branch: 'worklings/cafe-lumen',
    theme: 'cafe',
    rooms: [],
    goal: null,
    people: PEOPLE,
    proposal: null,
    tasks: [],
    messages: [],
    questions: [],
    approvals: [],
    statuses: [],
    reports: [],
    dashboards: [],
    screenshots: [],
    spend: { samples: [], hourly: [], byPerson: [] },
    log: [],
    pause: null,
    settings: { ...defaultSettings(), maxDesks: DEFAULT_MAX_DESKS, idleMs: DEFAULT_IDLE_MS, billing: 'plan', alwaysAllow: [] },
    desks: { working: 0, waiting: 0, max: DEFAULT_MAX_DESKS },
    preview: { state: 'off', url: null, command: null, problem: null },
    inbox: 0,
    seen: {},
    proposalEdited: false,
    problem: null,
    ...extra,
  };
}

export function dashboard(id: string, title: string, publishedAt: number, extra: Partial<Dashboard> = {}): Dashboard {
  return { id, title, by: 'ceo', publishedAt, widgets: [{ kind: 'stat', title: 'Days left', value: 12 }], ...extra };
}

export function entry(id: string, person: string, at: number, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return { id, at, person, people: [person], kind: 'status', text: `${person} at ${at}`, ...extra };
}
