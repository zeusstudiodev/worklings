// What the lobby learns once when the person arrives: a line about a company that left the lobby or the one they just
// removed (with Undo, which adds its folder back), and the company they came back from.

export interface LobbyNotice {
  text: string;
  /** Removed by you: Undo adds the folder back, and its `.worklings/` reopens the company. */
  undo?: { folder: string };
}

let pending: LobbyNotice | null = null;

export const setLobbyNotice = (notice: LobbyNotice): void => {
  pending = notice;
};

/** The notice waiting for the lobby, left in place until clearLobbyNotice() (a render may run twice). */
export const peekLobbyNotice = (): LobbyNotice | null => pending;

export const clearLobbyNotice = (): void => {
  pending = null;
};

// The company shown last, so the lobby's worlds can play its way out when the person comes back from it.
let shown: string | null = null;

export const noteCompanyShown = (id: string): void => {
  shown = id;
};

/** The company the person just left, left in place until clearCompanyShown() (a render may run twice). */
export const peekCompanyShown = (): string | null => shown;

export const clearCompanyShown = (): void => {
  shown = null;
};
