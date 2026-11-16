// The preview as a board (docs/design-v3.md, "Boards over the map": Preview uses the frame without the mini-map, which
// would cover the app): the project's app on paper over the mat, under the frame's head with its way back to the office.
// The bar, the device frames, the screenshots and every state are Preview's own.
import { BoardFrame } from '../shell/BoardFrame.tsx';
import type { BoardProps } from '../types.ts';
import { Preview } from './Preview.tsx';
import './preview.css';

export function PreviewBoard(props: BoardProps) {
  return (
    <BoardFrame title="Preview">
      <div className="pv-paper">
        <Preview {...props} />
      </div>
    </BoardFrame>
  );
}
