// The views other streams build, picked up when their files exist (the stage and dock is built by several streams at
// once). A glob with no match is empty, so a missing file leaves its place to the shell's own fallback; each view loads on
// its own and sits behind an error boundary, so one that fails to load or draw leaves the rest of the office working.
import { Component, type ComponentType, lazy, type ReactNode, Suspense } from 'react';
import type { TalkChip } from './palette/paletteModel.ts';
import type { TalkLink } from './talk/link.ts';
import type { BoardProps, TabProps } from './types.ts';

function required<T>(value: T | undefined, path: string, name: string): T {
  if (value === undefined) throw new Error(`${path} doesn't export ${name}.`);
  return value;
}

// The side panel's views, today's panels: the inbox opened on an item, a person, a task, a message's trace, the decision log.
const inboxLoad = import.meta.glob<{ Inbox?: ComponentType<TabProps & { focusItem?: string }> }>('./inbox/Inbox.tsx')['./inbox/Inbox.tsx'];
const personLoad = import.meta.glob<{ PersonPanel?: ComponentType<TabProps & { person: string }> }>('./person/PersonPanel.tsx')['./person/PersonPanel.tsx'];
const tasksLoad = import.meta.glob<{ Tasks?: ComponentType<TabProps & { task?: string; diff?: boolean }> }>('./tasks/Tasks.tsx')['./tasks/Tasks.tsx'];
const traceLoad = import.meta.glob<{ TraceView?: ComponentType<TabProps & { message: string }> }>('./trace/TraceView.tsx')['./trace/TraceView.tsx'];
const decisionsLoad = import.meta.glob<{ Decisions?: ComponentType<TabProps & { decision?: string | null }> }>('./decisions/Decisions.tsx')['./decisions/Decisions.tsx'];
// Today's panels shown as main views until their boards land: People under Org, the plan.
const peopleLoad = import.meta.glob<{ People?: ComponentType<TabProps> }>('./people/People.tsx')['./people/People.tsx'];
const planLoad = import.meta.glob<{ Plan?: ComponentType<TabProps & { version?: number | null }> }>('./plan/Plan.tsx')['./plan/Plan.tsx'];
// The boards over the map, under the paths their streams build them at (docs/design-v3.md, "Boards over the map").
const taskBoardLoad = import.meta.glob<{ TaskBoard?: ComponentType<BoardProps> }>('./tasks/board/TaskBoard.tsx')['./tasks/board/TaskBoard.tsx'];
const orgBoardLoad = import.meta.glob<{ OrgBoard?: ComponentType<BoardProps> }>('./org/OrgBoard.tsx')['./org/OrgBoard.tsx'];
const previewBoardLoad = import.meta.glob<{ PreviewBoard?: ComponentType<BoardProps> }>('./preview/PreviewBoard.tsx')['./preview/PreviewBoard.tsx'];
const diffBoardLoad = import.meta.glob<{ DiffBoard?: ComponentType<BoardProps> }>('./tasks/DiffBoard.tsx')['./tasks/DiffBoard.tsx'];
const dashboardsBoardLoad = import.meta.glob<{ DashboardsBoard?: ComponentType<BoardProps> }>('./dashboards/DashboardsBoard.tsx')['./dashboards/DashboardsBoard.tsx'];
// v0.2's progress view, the column every entry point lands on (docs/design-v3.md, "Progress").
const progressLoad = import.meta.glob<{ Progress?: ComponentType<TabProps & { now: number; onInbox: () => void }> }>('./progress/Progress.tsx')['./progress/Progress.tsx'];
// The talk bar with the live strip and the feed, at the main view's foot (docs/design-v3.md, "The talk bar").
const dockLoad = import.meta.glob<{ Dock?: ComponentType<DockProps> }>('./talk/Dock.tsx')['./talk/Dock.tsx'];

/**
 * The dock's props: every view's, the company's talk link, and where it stands. `onFeed` says when the feed opens or
 * closes; `onChip` runs a chip under the empty talk bar as the palette runs its command.
 */
export type DockProps = TabProps & { link: TalkLink; board: boolean; office: boolean; phone: boolean; founding: boolean; onFeed: (open: boolean) => void; onChip?: (chip: TalkChip) => void; /** The inbox shows beside the office: the strip leaves out what it lists. */ inboxBeside?: boolean };

export const Inbox = inboxLoad ? lazy(async () => ({ default: required((await inboxLoad()).Inbox, 'inbox/Inbox.tsx', 'Inbox') })) : null;
export const PersonPanel = personLoad ? lazy(async () => ({ default: required((await personLoad()).PersonPanel, 'person/PersonPanel.tsx', 'PersonPanel') })) : null;
export const Tasks = tasksLoad ? lazy(async () => ({ default: required((await tasksLoad()).Tasks, 'tasks/Tasks.tsx', 'Tasks') })) : null;
export const TraceView = traceLoad ? lazy(async () => ({ default: required((await traceLoad()).TraceView, 'trace/TraceView.tsx', 'TraceView') })) : null;
export const Decisions = decisionsLoad ? lazy(async () => ({ default: required((await decisionsLoad()).Decisions, 'decisions/Decisions.tsx', 'Decisions') })) : null;
export const People = peopleLoad ? lazy(async () => ({ default: required((await peopleLoad()).People, 'people/People.tsx', 'People') })) : null;
export const Plan = planLoad ? lazy(async () => ({ default: required((await planLoad()).Plan, 'plan/Plan.tsx', 'Plan') })) : null;
export const TaskBoard = taskBoardLoad ? lazy(async () => ({ default: required((await taskBoardLoad()).TaskBoard, 'tasks/board/TaskBoard.tsx', 'TaskBoard') })) : null;
export const OrgBoard = orgBoardLoad ? lazy(async () => ({ default: required((await orgBoardLoad()).OrgBoard, 'org/OrgBoard.tsx', 'OrgBoard') })) : null;
export const DashboardsBoard = dashboardsBoardLoad ? lazy(async () => ({ default: required((await dashboardsBoardLoad()).DashboardsBoard, 'dashboards/DashboardsBoard.tsx', 'DashboardsBoard') })) : null;
export const PreviewBoard = previewBoardLoad ? lazy(async () => ({ default: required((await previewBoardLoad()).PreviewBoard, 'preview/PreviewBoard.tsx', 'PreviewBoard') })) : null;
export const DiffBoard = diffBoardLoad ? lazy(async () => ({ default: required((await diffBoardLoad()).DiffBoard, 'tasks/DiffBoard.tsx', 'DiffBoard') })) : null;
export const Progress = progressLoad ? lazy(async () => ({ default: required((await progressLoad()).Progress, 'progress/Progress.tsx', 'Progress') })) : null;
export const Dock = dockLoad ? lazy(async () => ({ default: required((await dockLoad()).Dock, 'talk/Dock.tsx', 'Dock') })) : null;

interface BoundaryProps {
  /** What shows instead when the view can't load or draw. */
  fallback: ReactNode;
  /** Said in the live region when the view fails, once. */
  onFail?: () => void;
  children: ReactNode;
}

/** Keeps a part that fails to load or draw (a view, the 3D stage) from taking the office with it. */
export class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onFail?.();
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A mounted view: its fallback while it loads and if it fails. */
export function Mounted({ fallback, onFail, children }: { fallback: ReactNode; onFail?: () => void; children: ReactNode }) {
  return (
    <Boundary
      onFail={onFail}
      fallback={
        <>
          {fallback}
          <p className="shell-empty__meta">This view couldn't load. Reload the page to try again.</p>
        </>
      }
    >
      <Suspense fallback={<p className="shell-empty__meta">Opening…</p>}>{children}</Suspense>
    </Boundary>
  );
}
