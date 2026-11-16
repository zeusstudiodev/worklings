// A task's changes as a board (docs/design-v3.md, "Boards over the map": the diff uses the frame without the mini-map,
// which would cover the code): "Changes in “Build the streak card”" on paper over the mat, with "Back to the task".
// The diff itself, its folds and its states are TaskDiff's.
import { BoardFrame } from '../shell/BoardFrame.tsx';
import type { BoardProps } from '../types.ts';
import { TaskDiff } from './TaskDiff.tsx';
import './diff.css';
import './tasks.css';

export function DiffBoard({ view, company, companyId, actions, announce }: BoardProps) {
  const task = view.kind === 'diff' ? company.tasks.find((t) => t.id === view.task) : undefined;
  const title = task ? `Changes in “${task.title}”` : 'Changes';
  return (
    <BoardFrame title={title} backLabel="Back to the task">
      <div className="df-paper">
        {task?.commit ? (
          <TaskDiff companyId={companyId} task={{ id: task.id, commit: task.commit }} branch={company.branch} actions={actions} announce={announce} />
        ) : (
          <p className="df-paper__line">{task ? 'This task has no changes to show yet.' : "That task isn't on the board any more."}</p>
        )}
      </div>
    </BoardFrame>
  );
}
