// Small, realistic companies for the panels' pure models (test/panels-work-*.test.ts): factories in the contract's
// shapes, so a change to src/core/company.ts shows up here as a type error.
import { defaultSettings } from '../src/core/company-state.ts';
import {
  type Approval,
  type CompanyView,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_DESKS,
  type DeskView,
  type Message,
  type PersonView,
  type Question,
  type Report,
  type Task,
} from '../src/core/company.ts';
import type { AgentState } from '../src/core/office.ts';
import type { Snapshot } from '../src/core/snapshot.ts';
import type { Studio } from '../src/core/studio.ts';
import { ZERO_USAGE } from '../src/core/usage.ts';

/** 14:00 on 5 Nov 2026, local time: the moment every test looks from. */
export const NOW = new Date(2026, 10, 5, 14, 0, 0).getTime();
export const min = (n: number) => n * 60_000;
export const sec = (n: number) => n * 1000;

export function desk(state: DeskView['state'], extra: Partial<DeskView> = {}): DeskView {
  return { person: '', state, sessionId: null, since: NOW - min(5), context: null, problem: null, queue: null, ...extra };
}

export function person(id: string, name: string, title: string, room: string, extra: Partial<PersonView> = {}): PersonView {
  const p: PersonView = {
    id,
    name,
    title,
    level: 'worker',
    room,
    reportsTo: null,
    look: {},
    model: 'sonnet',
    desk: desk('closed'),
    task: null,
    status: null,
    agentKey: null,
    cost: 0,
    ...extra,
  };
  return { ...p, desk: { ...p.desk, person: id } };
}

/** The café company: Noor the CEO, Tia the office manager, two heads, a team lead and their people. */
export function cafePeople(): PersonView[] {
  return [
    person('ceo', 'Noor', 'CEO', 'direction', { level: 'ceo', model: 'opus' }),
    person('head-of-engineering', 'Ben', 'Head of engineering', 'engineering', { level: 'head', reportsTo: 'ceo' }),
    person('frontend-lead', 'Ola', 'Frontend lead', 'engineering', { level: 'lead', reportsTo: 'head-of-engineering' }),
    person('frontend-engineer', 'Kai', 'Frontend engineer', 'engineering', { reportsTo: 'frontend-lead' }),
    person('qa-engineer', 'QA engineer', 'QA engineer', 'engineering', { reportsTo: 'head-of-engineering' }),
    person('head-of-design', 'Ada', 'Head of design', 'design', { level: 'head', reportsTo: 'ceo' }),
    person('ui-designer', 'Mina', 'UI designer', 'design', { reportsTo: 'head-of-design' }),
    person('office-manager', 'Tia', 'Office manager', 'direction', { reportsTo: 'ceo' }),
  ];
}

export function company(extra: Partial<CompanyView> = {}): CompanyView {
  return {
    id: 'plant-pal',
    name: 'Plant Pal',
    phase: 'running',
    prompt: 'A café website with pickup orders',
    stakeholder: 'Robin',
    branch: 'worklings/plant-pal',
    theme: 'cafe',
    rooms: [],
    goal: null,
    people: cafePeople(),
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

/** A company with someone changed: `set(company.people)` returns the people to use. */
export function withPeople(c: CompanyView, change: (people: PersonView[]) => PersonView[]): CompanyView {
  return { ...c, people: change(c.people.map((p) => ({ ...p }))) };
}

export function update(c: CompanyView, id: string, extra: Partial<PersonView>): CompanyView {
  return withPeople(c, (people) => people.map((p) => (p.id === id ? { ...p, ...extra, desk: { ...p.desk, ...extra.desk, person: id } } : p)));
}

export function task(id: string, owner: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    brief: `Brief for ${title}`,
    owner,
    askedBy: 'head-of-engineering',
    files: [],
    doneWhen: 'It works.',
    status: 'queued',
    outcome: null,
    parent: null,
    milestone: null,
    worktree: null,
    commit: null,
    createdAt: NOW - min(60),
    updatedAt: NOW - min(30),
    ...extra,
  };
}

export function question(id: string, from: string, text: string, options: string[], extra: Partial<Question> = {}): Question {
  return { id, from, text, options, recommended: null, taskId: null, askedAt: NOW - min(2), answer: null, withdrawn: null, ...extra };
}

export function approval(id: string, person: string, summary: string, extra: Partial<Approval> = {}): Approval {
  return {
    id,
    person,
    tool: 'Bash',
    summary,
    detail: 'git push origin worklings/plant-pal',
    kind: 'push',
    askedAt: NOW - min(3),
    expiresAt: NOW + min(20),
    alwaysRule: { rule: 'Bash(git push origin *)', sentence: 'any git push to origin.' },
    answer: null,
    withdrawn: null,
    ...extra,
  };
}

export function message(id: string, from: string, to: string, text: string, extra: Partial<Message> = {}): Message {
  return { id, from, to, text, origin: null, relayOf: null, note: null, at: NOW - min(10), deliveredAt: null, interrupt: false, ...extra };
}

export function report(id: string, by: string, to: string, text: string, extra: Partial<Report> = {}): Report {
  return { id, person: by, to, taskId: null, outcome: 'progress', text, at: NOW - min(20), ...extra };
}

export const studio: Studio = {
  version: 1,
  name: 'Plant Pal',
  domain: 'website',
  rigor: 'standard',
  departments: [
    { id: 'direction', name: 'Direction', style: 'direction' },
    { id: 'design', name: 'Design', style: 'design' },
    { id: 'engineering', name: 'Engineering', style: 'engineering' },
  ],
  roles: [],
  rules: [],
  gates: [],
  skills: [],
  fired: [],
};

export function agent(key: string, sessionId: string, extra: Partial<AgentState> = {}): AgentState {
  return {
    key,
    sessionId,
    agentId: null,
    agentType: 'lead',
    kind: 'lead',
    roleId: null,
    name: 'Lead',
    task: null,
    purpose: null,
    briefedAt: null,
    status: 'working',
    statusSince: NOW - min(4),
    busySince: NOW - min(4),
    tool: null,
    skill: null,
    startedAt: NOW - min(10),
    lastEventAt: NOW - min(1),
    endedAt: null,
    toolCalls: 0,
    toolErrors: 0,
    files: [],
    usage: ZERO_USAGE,
    requests: 0,
    models: {},
    costEstimate: 0,
    costReported: null,
    reportedRequests: 0,
    unpricedTokens: 0,
    lastMessage: null,
    reportedAt: null,
    contextTokens: 0,
    question: null,
    waitingFor: null,
    refused: null,
    error: null,
    errorFrom: null,
    ...extra,
  };
}

/** The snapshot fields the panels read, around a company. */
export function snapshotOf(c: CompanyView, extra: Partial<Pick<Snapshot, 'agents' | 'studio'>> = {}): Pick<Snapshot, 'agents' | 'studio' | 'project' | 'serverTime'> & { company: CompanyView } {
  return { agents: [], studio, project: { name: c.name, root: 'C:\\Users\\jamie\\plant-pal' }, serverTime: NOW, company: c, ...extra };
}
