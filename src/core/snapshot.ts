// What the server sends the browser: shared by both sides so the web app never imports server code.
import type { AsideView } from './aside.ts';
import type { CompanyView } from './company.ts';
import type { BaseDepartment, BaseDepartmentInfo } from './departments.ts';
import type { AgentState, ArchivedPerson, GateRun, MilestoneEntry, SessionState, TaskState, Totals } from './office.ts';
import type { Studio } from './studio.ts';

export type OfficeMode = 'live' | 'replay' | 'demo';
export type StudioSource = 'manifest' | 'inferred' | 'none';

export interface ReplayInfo {
  sessionId: string;
  title: string;
  /** Session time shown, from the first to the last event. */
  startedAt: number;
  endedAt: number;
  position: number;
  speed: number;
  playing: boolean;
}

export interface Snapshot {
  project: { name: string; root: string };
  mode: OfficeMode;
  studio: Studio | null;
  studioSource: StudioSource;
  studioErrors: string[];
  sessions: SessionState[];
  agents: AgentState[];
  tasks: TaskState[];
  gateRuns: GateRun[];
  /** The latest milestones, which the story tells (story.ts); the steps between them stay on the server. */
  activity: MilestoneEntry[];
  /** The studio's spend plus the office's own (questions and catch-ups), so no figure leaves the office out. */
  totals: Totals;
  /** Sessions the office let go of and what their people cost: the payroll adds them in. */
  archived: { sessions: number; people: ArchivedPerson[] };
  burn: { dollarsPerHour: number };
  hooks: { lastEventAt: number | null; ignored: number };
  replay: ReplayInfo | null;
  /** Ask aside and Catch me up: the running call, answers, digests, the next catch-up and the office's own spend. */
  aside: AsideView;
  /** v3: the company this office runs; absent (or null) when the office only watches. */
  company?: CompanyView | null;
  serverTime: number;
  pricesAsOf: string;
}

/** A recorded session that can be replayed (GET /api/sessions). */
export interface SessionSummary {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  subagents: number;
}

export interface CatalogRole {
  id: string;
  title: string;
  department: BaseDepartment;
  description: string;
  model: string;
}

/** GET /api/studio: the files behind the studio and what can be hired. */
export interface StudioCatalog {
  studio: Studio | null;
  source: StudioSource;
  errors: string[];
  agents: { id: string; description: string; model: string; tools: string[]; file: string }[];
  rules: { id: string; description: string; paths: string[]; body: string }[];
  skills: { id: string; description: string }[];
  library: CatalogRole[];
  departments: Record<BaseDepartment, BaseDepartmentInfo>;
}

export type ReshapeAction =
  /** `reportsTo` is a person's id; left out, the hire reports to the head of the room they join, or to the CEO. */
  | { action: 'hire'; role: string; department?: string; reportsTo?: string }
  | { action: 'fire'; role: string }
  | { action: 'rehire'; role: string }
  | { action: 'move'; role: string; department: string }
  | { action: 'model'; role: string; model: 'inherit' | 'opus' | 'sonnet' | 'haiku' }
  | { action: 'rule'; rule: string; body: string };

export interface ReshapeResult {
  ok: boolean;
  message: string;
  /** Files changed, relative to the project root. */
  changed: string[];
}
