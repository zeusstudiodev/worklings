// The web side of the v3 contract: what every company tab is given and the actions it can take. The live office
// binds the actions to the hub's routes (docs/architecture.md); the demo company binds them to local state.
import type { ReactNode } from 'react';
import type { CompanySettings, CompanyView, DeskView, Message, MessagePage, OfficeChange, PreviewView, Task } from '../../../src/core/company.ts';
import type { OrgProposal } from '../../../src/core/org.ts';
import type { PresetId } from '../../../src/core/presets.ts';
import type { ReshapeAction, ReshapeResult, Snapshot } from '../../../src/core/snapshot.ts';
import type { Level, RoleModel } from '../../../src/core/studio.ts';
import type { NewTaskInput, Plan, PlanComment, Recipient, SettingsChange, SteeringSettings } from '../../../src/core/steering.ts';
import type { MainView } from './address.ts';

/** A refused or failed action: the office's own sentence, ready to show as it is. */
export class ActionError extends Error {
  readonly status: number;
  /** A word for the code to act on: "conflict", "not-allowed", "offline"... */
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * How a message was written. `typed`: the person typed these words in a box. Only typed words can be cited as their
 * word (the CEO acting "as you asked"), so a button's own text never sets it.
 */
export interface SendOptions {
  typed?: boolean;
}

/** What the stakeholder can do in a company. Every action rejects with an ActionError when refused. */
export interface CompanyActions {
  say(to: string, text: string, options?: SendOptions): Promise<Message>;
  unsend(message: string): Promise<void>;
  stop(person: string, instruction: string, options?: SendOptions): Promise<void>;
  answer(question: string, option: number | null, text: string): Promise<void>;
  /** Answers every open scoping question with the CEO's pick, each with its undo window. */
  answerWithPicks(): Promise<void>;
  /**
   * One press for asks raised together (`CompanyView.batches`): each question takes its asker's pick and each approval the
   * office's recommendation, never as "always". `left` counts the questions with no pick, which stay open.
   */
  answerBatch(batch: string): Promise<{ answered: number; left: number }>;
  decide(approval: string, decision: 'allow' | 'deny', always: boolean, note: string | null): Promise<void>;
  /** Takes back an answer or a decision within its undo window. */
  undo(item: string): Promise<void>;
  editProposal(proposal: OrgProposal): Promise<{ ok: true } | { ok: false; errors: string[] }>;
  restoreProposal(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  changeOffice(change: OfficeChange): Promise<ReshapeResult>;
  /** Takes one of the CEO's published dashboards down. */
  removeDashboard(dashboard: string): Promise<void>;
  /** Fire, rehire, move, change model: v2's reshape, for the person's details. */
  reshape(action: ReshapeAction): Promise<ReshapeResult>;
  preview(action: 'start' | 'stop'): Promise<PreviewView>;
  taskDiff(task: string): Promise<string>;
  screenshotUrl(shot: string): string;
  handOver(person: string): Promise<DeskView>;
  bringBack(person: string): Promise<DeskView>;
  updateSettings(input: { maxDesks?: number; removeRule?: string }): Promise<CompanySettings>;
  /**
   * v0.2's spending plan. Before the start only (the office refuses after it): the preset sets the desks at once and the
   * models of whatever was not set by hand, and asks the CEO to revise a proposal to it.
   */
  setPreset(preset: PresetId): Promise<CompanySettings>;
  /** One model for everyone at a level, in the settings and in the proposal together. Before the start only. */
  setModels(change: Partial<Record<Level, RoleModel>>): Promise<CompanySettings>;
  /** The company's and each person's budget in dollars to the cent; null clears one. Works while the company runs. */
  setBudget(change: { company?: number | null; person?: number | null }): Promise<CompanySettings>;
  markSeen(person: string): Promise<void>;
  /**
   * v0.2: the stakeholder has the company open (`POST /api/c/<id>/looked`, 204), for "Since you last looked". The shell
   * sends it when the office opens and every few minutes while it shows; the hub keeps one a minute at most.
   */
  looked(): Promise<void>;
  /**
   * The feed's "Show earlier lines": up to `limit` (1 to MESSAGE_PAGE.max, 200 when left out) of the messages the
   * company keeps before message `before`, newest first, with their acknowledgements; `more` is false once nothing older
   * is kept. Pass the oldest message you hold in the company's order: `company.messages[0]` (the view is oldest first),
   * then the last message of the page before. Messages can repeat ones you hold, so merge by id. A `before` the company
   * no longer keeps is refused with code `unknown`.
   */
  earlierMessages(before: string, limit?: number): Promise<MessagePage>;
}

/** What the shell gives every company tab and panel. */
export interface TabProps {
  /** The office's snapshot (v2's agents, totals and aside) with the company in it. */
  snapshot: Snapshot;
  company: CompanyView;
  companyId: string;
  actions: CompanyActions;
  /**
   * Goes to a view inside the company from the one shown, as today's views write it ("people/kai", "tasks/t-12",
   * "inbox#q-3", "send/room/design", or a new address with `?panel=`): a side panel view opens over the main view shown,
   * a main view keeps the side panel's view on desktops (address.ts, openSub). Every change of address pushes.
   */
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /** Says something through the office's one polite live region. */
  announce: (text: string) => void;
  /** False while the office is unreachable: whatever sends is unavailable, with the reconnecting line as the reason. */
  online: boolean;
  /** v2's Catch me up, bound by the shell to this company's routes; null where it can't run (the demo). */
  catchUp: ReactNode;
  /** Opens v2's room card for a department. */
  openRoom: (room: string) => void;
  /** Opens a visitor's badge, with Ask aside. */
  openVisitor: (agentKey: string) => void;
  /** Phones: the sheet takes the full height while someone types, and goes back after. */
  expandSheet: (expanded: boolean) => void;
  /** Steering, once the shell binds it (SteeringTabProps). */
  steer?: SteeringActions;
  /** The talk bar's To and Stop (stage and dock): the only way any view sets who hears what the talk bar sends. */
  talk: TalkControl;
}

// ---------------------------------------------------------------------------------------------------------------
// Stage and dock (docs/design-v3.md, "Stage and dock"): the seams between the shell, the talk bar and the boards, so
// each is built on its own. The shell provides TalkControl and mounts the boards; the talk bar implements TalkControl.

/**
 * How the rest of the office sets the talk bar's To; nothing else sets it. Every way of opening someone goes through
 * `offer` (a click in the office, a chart node, a name in the feed, a deep link to their panel), so they all agree.
 */
export interface TalkControl {
  /** Opening someone: they become the To only while the box is empty, so a half-written draft keeps its To. */
  offer(to: Recipient): void;
  /**
   * "Message Kai", Reply and the like: the To changes even with words in the box (the draft stays, and the box says the
   * new To in words). `focus` moves focus to the box; `draft` fills an empty box with suggested words.
   */
  to(to: Recipient, options?: { focus?: boolean; draft?: string }): void;
  /** Turns the talk bar into Stop for a person: what is typed goes as the Stop's instruction (SPEC-v3, "Stop"). */
  stop(person: string): void;
  /** Focus to the talk bar's box, as Enter on nothing does. */
  focus(): void;
}

/**
 * A board over the map (Org, Tasks, Dashboards): what every view gets, the board's sub-view from its address and the
 * frame's result row. A board renders the shell's BoardFrame as its root.
 */
export interface BoardProps extends TabProps {
  /** The main view the address names: the board itself or one of its sub-views (Tasks' plan, a dashboard, decisions). */
  view: MainView;
  /** The row under the frame's header: what the last action did, with its Undo while the change can be taken back. */
  result: (text: string, undo?: () => Promise<void>) => void;
}

/**
 * The stakeholder's steering actions (SPEC-v3.md "Steering"): bound to the hub's steering routes in the live office and
 * to local state in the demo company. Optional on TabProps (`steer`) until both bindings land; every action rejects with an
 * ActionError when refused, like CompanyActions.
 */
export interface SteeringActions {
  // The plan.
  editPlan(plan: Plan, note: string | null): Promise<{ ok: true } | { ok: false; errors: string[] }>;
  approvePlan(version: number, through: string | null): Promise<void>;
  commentPlan(on: PlanComment['on'], text: string): Promise<void>;
  // Messages to anyone, and following them.
  send(to: Recipient, text: string, forPeople: string[], options?: SendOptions): Promise<Message[]>;
  remind(message: string, person: string): Promise<void>;
  escalate(message: string, person: string): Promise<void>;
  // The task board.
  orderTasks(ids: string[]): Promise<void>;
  pauseTask(task: string): Promise<void>;
  resumeTask(task: string): Promise<void>;
  /** Pauses or resumes every open task of a room's people. */
  pauseRoom(room: string): Promise<void>;
  resumeRoom(room: string): Promise<void>;
  cancelTask(task: string, reason: string): Promise<void>;
  reassignTask(task: string, to: string, note: string): Promise<void>;
  createTask(input: NewTaskInput): Promise<Task>;
  // The decision log.
  undoDecision(decision: string): Promise<void>;
  reconsider(decision: string, note: string): Promise<void>;
  // Settings, the leash, model and effort.
  changeSettings(change: SettingsChange): Promise<SteeringSettings>;
}
