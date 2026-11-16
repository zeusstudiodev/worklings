// A finished task's diff in the wide view (docs/design-v3.md, "Tasks"): a fold per file, the first five open, unified
// with line numbers and + and − in the gutter, 500 lines a file and then the command that shows the rest. Colour is the
// one code convention here (added on green, removed on red), and the signs say it too.
import { useEffect, useEffectEvent, useState } from 'react';
import type { CompanyActions } from '../types.ts';
import { CopyButton } from '../people/shared.tsx';
import { changedLine, changeWord, type DiffFile, DIFF_FILES_OPEN, diffFailedLine, fileCounts, fileCountsSaid, moreCommand, moreLines } from './diffModel.ts';
import { diffKey, forgetDiff, loadDiff, useDiff } from './diffStore.ts';

interface Props {
  companyId: string;
  task: { id: string; commit: string };
  branch: string | null;
  actions: CompanyActions;
  announce: (text: string) => void;
}

const SIGN: Record<string, string> = { add: '+', del: '−', ctx: '', hunk: '', note: '' };

export function TaskDiff({ companyId, task, branch, actions, announce }: Props) {
  const key = diffKey(companyId, task.id, task.commit);
  const read = useDiff(key);
  const start = useEffectEvent(() => loadDiff(key, () => actions.taskDiff(task.id)));
  useEffect(() => start(), [key]);

  if (!read || read.state === 'loading') {
    return (
      <p className="diff__status" role="status">
        Reading the diff…
      </p>
    );
  }
  if (read.state === 'failed') {
    return (
      <div className="diff__status">
        <p>{diffFailedLine(read.error)}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            forgetDiff(key);
            loadDiff(key, () => actions.taskDiff(task.id));
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  const { diff } = read;
  return (
    <div className="diff">
      <p className="diff__summary">{changedLine(diff, task.commit, branch)}</p>
      {diff.files.length === 0 && <p className="muted">The commit changed no files.</p>}
      {diff.files.map((f, i) => (
        <FileDiff key={`${i}:${f.path}`} file={f} startOpen={i < DIFF_FILES_OPEN} commit={task.commit} announce={announce} />
      ))}
    </div>
  );
}

/** One file. Its lines are drawn only while it is open, so a big commit stays light until you look. */
function FileDiff({ file, startOpen, commit, announce }: { file: DiffFile; startOpen: boolean; commit: string; announce: (text: string) => void }) {
  const [open, setOpen] = useState(startOpen);
  const change = changeWord(file);
  return (
    <details className="diff-file" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="diff-file__head">
        <span className="diff-file__path">{file.path}</span>
        {change && <span className="diff-file__change">{change}</span>}
        <span className="diff-file__counts" aria-hidden="true">
          {fileCounts(file)}
        </span>
        <span className="visually-hidden">, {fileCountsSaid(file)}</span>
      </summary>
      {open &&
        (file.binary ? (
          <p className="diff-file__binary">A binary file changed.</p>
        ) : file.lines.length === 0 ? (
          <p className="diff-file__binary">{file.change === 'renamed' ? 'Renamed, with the same contents.' : 'No lines changed.'}</p>
        ) : (
          // A tab stop of its own, so long lines can be scrolled from the keyboard.
          <div className="diff-file__body" role="region" aria-label={`Changes in ${file.path}`} tabIndex={0}>
            <table className="diff-table">
              <thead className="visually-hidden">
                <tr>
                  <th scope="col">Line before</th>
                  <th scope="col">Line after</th>
                  <th scope="col">Change</th>
                  <th scope="col">Code</th>
                </tr>
              </thead>
              <tbody>
                {file.lines.map((l, i) =>
                  l.kind === 'hunk' || l.kind === 'note' ? (
                    <tr key={i} className={`diff-line diff-line--${l.kind}`}>
                      <td colSpan={4} className="diff-line__code">
                        {l.text}
                      </td>
                    </tr>
                  ) : (
                    <tr key={i} className={`diff-line diff-line--${l.kind}`}>
                      <td className="diff-line__num">{l.old ?? ''}</td>
                      <td className="diff-line__num">{l.new ?? ''}</td>
                      <td className="diff-line__sign">{SIGN[l.kind]}</td>
                      <td className="diff-line__code">{l.text}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ))}
      {open && file.more > 0 && (
        <p className="diff-file__more">
          {moreLines(file)} <code className="diff-file__command">{moreCommand(file, commit)}</code> <CopyButton text={moreCommand(file, commit)} what="the command" announce={announce} />
        </p>
      )}
    </details>
  );
}
