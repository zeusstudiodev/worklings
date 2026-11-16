// The shell's side of a board over the map (docs/design-v3.md, "Boards over the map"): the row under the board's head
// that says what the last press did, with its Undo, and "Back to the office". The shell provides it around the board it
// mounts; BoardFrame (shell/BoardFrame.tsx) reads it, so a board passes the frame only its own title, views and keys.
import { createContext, useContext } from 'react';

/** What a press on the board did, shown for 10 s under its head; `key` tells two equal sentences apart. */
export interface BoardResult {
  text: string;
  undo?: () => Promise<void>;
  key: number;
}

export interface BoardHost {
  /** The row under the head, or null when there is nothing to say. */
  result: BoardResult | null;
  /** Ends the row: its 10 s ran out, or its Undo went. */
  dismiss(): void;
  /** Back to the office: the main view becomes the office again, as Escape, the mini-map and Office in the views do. */
  close(): void;
  /** The feed lies over the board: its body is out of the focus order (inert) while its head stays reachable. */
  feedOpen: boolean;
}

export const BoardHostContext = createContext<BoardHost | null>(null);

/** The board's host, or null outside a board the shell mounted (a board drawn on its own, in a test or a harness). */
export const useBoardHost = (): BoardHost | null => useContext(BoardHostContext);
