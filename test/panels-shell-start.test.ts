// The start form's folder (web/src/company/start/startModel.ts): what it says about the folder typed, against a fake
// hub that answers as src/hub/folders.ts does.
import { describe, expect, it } from 'vitest';
import { type FolderInfo, type HubActions, OFFLINE_SENTENCE } from '../web/src/company/api.ts';
import { aboutFolder, NO_PARENT, newFolderLine, readFolder } from '../web/src/company/start/startModel.ts';
import { ActionError } from '../web/src/company/types.ts';

const COMPANIES = 'C:\\Users\\you\\Projects\\companies';

const listing = (path: string): FolderInfo => ({ path, parent: null, folders: [], detected: 'A folder with no app Worklings recognises.', notes: [], refusal: null, packs: null });

/** A hub that knows these folders, answers others as missing, and records what it was asked. */
function fakeFolders(existing: readonly string[], refuse: Record<string, ActionError> = {}) {
  const asked: { path: string; chosen: boolean }[] = [];
  const hub: Pick<HubActions, 'folders'> = {
    async folders(path, options = {}) {
      asked.push({ path, chosen: options.chosen === true });
      const refusal = refuse[path];
      if (refusal) throw refusal;
      if (!existing.includes(path)) throw new ActionError(404, "That folder doesn't exist.", 'missing');
      return listing(path);
    },
  };
  return { hub, asked };
}

describe('the folder the person typed', () => {
  it('is read as the chosen one, which the hub reads with git', async () => {
    const { hub, asked } = fakeFolders([`${COMPANIES}\\plant-pal`]);
    await expect(readFolder(hub, `${COMPANIES}\\plant-pal`)).resolves.toEqual({ kind: 'folder', folder: listing(`${COMPANIES}\\plant-pal`) });
    expect(asked).toEqual([{ path: `${COMPANIES}\\plant-pal`, chosen: true }]);
  });

  it("is one Start makes when it isn't there yet but its parent is", async () => {
    const { hub, asked } = fakeFolders([COMPANIES]);
    await expect(readFolder(hub, `${COMPANIES}\\fern-co`)).resolves.toEqual({ kind: 'new', parent: COMPANIES });
    // The parent is only looked at, not chosen: the hub runs no git there.
    expect(asked).toEqual([
      { path: `${COMPANIES}\\fern-co`, chosen: true },
      { path: COMPANIES, chosen: false },
    ]);
    expect(newFolderLine(COMPANIES)).toBe('No folder here yet. Starting makes it in C:\\Users\\you\\Projects\\companies.');
    expect(newFolderLine('C:\\Users\\jamie\\AppData\\Local\\Temp\\claude\\scratchpad\\companies')).toBe('No folder here yet. Starting makes it in C:\\Users\\…\\companies.');
  });

  it("can't be started in when neither it nor its parent is there, as the hub's start check says", async () => {
    const { hub } = fakeFolders([]);
    await expect(readFolder(hub, `${COMPANIES}\\fern-co`)).resolves.toEqual({ kind: 'refused', refusal: NO_PARENT });
  });

  it("says the office's own reason for anything else, and that it didn't answer when it didn't", async () => {
    const link = new ActionError(400, "That folder is a link. Pick the folder it points to: Worklings doesn't work through links.", 'bad-folder');
    const { hub } = fakeFolders([], { 'C:\\link': link, 'C:\\gone': new ActionError(0, OFFLINE_SENTENCE, 'offline') });
    await expect(readFolder(hub, 'C:\\link')).resolves.toEqual({ kind: 'refused', refusal: link.message });
    await expect(readFolder(hub, 'C:\\gone')).resolves.toEqual({ kind: 'refused', refusal: OFFLINE_SENTENCE });
  });

  it('is missing at a drive with nothing above it to make it in', async () => {
    const { hub } = fakeFolders([], { 'C:\\': new ActionError(404, "That folder doesn't exist.", 'missing') });
    await expect(readFolder(hub, 'C:\\')).resolves.toEqual({ kind: 'refused', refusal: "That folder doesn't exist." });
  });
});

describe('a refused start', () => {
  it('is about the folder for the folder codes, so it shows by the folder field once', () => {
    for (const code of ['bad-folder', 'missing', 'exists', 'inside', 'around', 'link', 'copy', 'cannot-run']) expect(aboutFolder(new ActionError(409, 'No.', code))).toBe(true);
    for (const code of ['bad-input', 'closing', 'offline', 'locked', null]) expect(aboutFolder(new ActionError(400, 'No.', code))).toBe(false);
    expect(aboutFolder(new Error('No.'))).toBe(false);
  });
});
