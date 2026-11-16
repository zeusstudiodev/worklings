// v0.7 (SPEC-v0.7.md, "Granularity"): a plain job's task board. One Claude Code session does the work, so the board is
// that session's own structure, read from its stream without changing it: its todo list (TodoWrite, or the task tools)
// and the helpers it starts with the Agent tool, each with what it cost.
import type { HelperView, TodoItem } from '../../../../../src/core/plain.ts';
import { dollars } from '../../../lib/format.ts';
import { BoardFrame } from '../../shell/BoardFrame.tsx';
import type { BoardProps } from '../../types.ts';
import { StatePill, type StateTone } from '../../ui/StatePill.tsx';
import './session-board.css';

const TODO_STATE: Record<TodoItem['status'], { label: string; tone: StateTone }> = {
  pending: { label: 'To do', tone: 'waiting' },
  in_progress: { label: 'Doing', tone: 'working' },
  completed: { label: 'Done', tone: 'done' },
};

const HELPER_STATE: Record<HelperView['state'], { label: string; tone: StateTone }> = {
  working: { label: 'At work', tone: 'working' },
  done: { label: 'Done', tone: 'done' },
  failed: { label: 'Stopped', tone: 'error' },
};

/** "2 of 5 done" for the board's summary; null for no list. */
export function todoSummary(todos: readonly TodoItem[]): string | null {
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  return `${done} of ${todos.length} done`;
}

export function SessionBoard({ company }: BoardProps) {
  const todos = company.todos ?? [];
  const helpers = company.helpers ?? [];
  const spentOnHelpers = helpers.reduce((sum, h) => sum + h.costUsd, 0);
  return (
    <BoardFrame title="Tasks" summary={todoSummary(todos) ?? undefined}>
      <div className="sb" data-tb-vscroll>
        <section className="sb__part" aria-labelledby="sb-list">
          <h3 id="sb-list" className="sb__head">
            Claude Code's list
          </h3>
          {todos.length === 0 ? (
            <div className="tb-empty">
              <p>No list yet. Claude Code keeps one when it splits the work into steps, and it shows here as it changes.</p>
              <p>Newer models keep a list only when your Claude Code turns its todo tools on.</p>
            </div>
          ) : (
            <ol className="sb__todos">
              {todos.map((t) => {
                const state = TODO_STATE[t.status];
                return (
                  <li key={t.id} className={`sb__todo sb__todo--${t.status}`}>
                    <span className="sb__text">{t.text}</span>
                    <StatePill label={state.label} tone={state.tone} detail={`${state.label}: ${t.text}`} />
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <section className="sb__part" aria-labelledby="sb-helpers">
          <h3 id="sb-helpers" className="sb__head">
            Helpers{helpers.length > 0 ? `, ${dollars(spentOnHelpers)} so far` : ''}
          </h3>
          {helpers.length === 0 ? (
            <div className="tb-empty">
              <p>No helpers yet. When Claude Code hands part of the work to a subagent, it sits beside the desk and shows here with its own cost.</p>
            </div>
          ) : (
            <ul className="sb__helpers">
              {helpers.map((h) => {
                const state = HELPER_STATE[h.state];
                return (
                  <li key={h.id} className="sb__helper">
                    <span className="sb__text">
                      <span className="sb__kind">{h.type}</span>
                      {h.description ? <span className="sb__what">{h.description}</span> : null}
                    </span>
                    <span className="sb__cost">{dollars(h.costUsd)}</span>
                    <StatePill label={state.label} tone={state.tone} detail={`${h.type} helper, ${state.label.toLowerCase()}, ${dollars(h.costUsd)}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </BoardFrame>
  );
}
