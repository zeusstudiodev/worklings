// What the start form says about its folder (docs/design-v3.md, "Start a company"): what the hub found there, a new
// folder Start makes in a parent that exists, or why a company can't start there. Pure but for the hub it asks.
import { type FolderInfo, type HubActions, OFFLINE_SENTENCE } from '../api.ts';
import { cutMiddle } from '../model.ts';
import { parentOf } from '../paths.ts';
import { ActionError } from '../types.ts';

export type FolderReading =
  | { kind: 'folder'; folder: FolderInfo }
  /** Not there yet, in a folder that is: Start makes it. */
  | { kind: 'new'; parent: string }
  | { kind: 'refused'; refusal: string };

/** What the hub's start check says too when neither the folder nor the one it would go in exists. */
export const NO_PARENT = "That folder doesn't exist, and neither does the folder it would go in. Make it with New folder here.";

const reason = (error: unknown) => (error instanceof Error && error.message.trim() ? error.message.trim() : OFFLINE_SENTENCE);
const missing = (error: unknown) => error instanceof ActionError && error.code === 'missing';

/**
 * Reads the folder the person typed, as the one they chose (the hub runs git only there). A folder that isn't there
 * yet is fine when its parent is, since Start makes it.
 */
export async function readFolder(hub: Pick<HubActions, 'folders'>, path: string): Promise<FolderReading> {
  try {
    return { kind: 'folder', folder: await hub.folders(path, { chosen: true }) };
  } catch (error) {
    const parent = missing(error) ? parentOf(path) : null;
    if (parent === null) return { kind: 'refused', refusal: reason(error) };
    try {
      await hub.folders(parent);
      return { kind: 'new', parent };
    } catch (inner) {
      return { kind: 'refused', refusal: missing(inner) ? NO_PARENT : reason(inner) };
    }
  }
}

/** "No folder here yet. Starting makes it in C:\…\companies." */
export const newFolderLine = (parent: string): string => `No folder here yet. Starting makes it in ${cutMiddle(parent, 40)}.`;

/** The codes of the hub's start refusals that are about the folder (src/hub/folders.ts and addCompany). */
const FOLDER_CODES = new Set(['bad-folder', 'missing', 'exists', 'inside', 'around', 'link', 'copy', 'cannot-run']);

/** Whether a refused start is about the folder, so it shows by the folder field instead of a second time below. */
export const aboutFolder = (error: unknown): boolean => error instanceof ActionError && error.code !== null && FOLDER_CODES.has(error.code);
