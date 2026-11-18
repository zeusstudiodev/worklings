// The start form's Add row (SPEC-v0.9.md, "The start form"): one line per pack, off unless the person ticks it, with a
// recommendation only where the pack met its decision rule for this kind of request. Pure.
import { type FolderPacks, PACKS, type PackId, recommendPacks } from '../../../../src/core/packs.ts';

export interface PackRowLine {
  id: PackId;
  title: string;
  does: string;
  forWhat: string;
  cost: string;
  /** What the bench measured, in plain words. */
  measured: string;
  checked: boolean;
  disabled: boolean;
  /** Why it can't be ticked, or that the folder has it already. */
  note: string | null;
  /** "For a short request", when recommended. */
  recommended: string | null;
}

export interface PackRowView {
  /** Why no pack can be added here, or null. */
  blocked: string | null;
  lines: PackRowLine[];
  /** The sentence under the legend. */
  lead: string;
}

export const PACKS_LEAD = "Packs are off unless you add them. Each is plain files in the project's .claude/ that you can read, edit or delete.";

/** Whether a pack can be added to the folder: not there yet, and nothing of the person's own in its place. */
const addable = (folder: FolderPacks | null, id: PackId): boolean => folder === null || (folder.blocked === null && folder.packs[id].state === 'absent');

export function packRowView(folder: FolderPacks | null, words: string, chosen: readonly PackId[]): PackRowView {
  const have = folder ? PACKS.filter((p) => folder.packs[p.id].state === 'installed' || folder.packs[p.id].state === 'edited').map((p) => p.id) : [];
  const recommended = folder && folder.blocked === null ? recommendPacks({ domain: folder.domain, empty: folder.empty, words }, have) : [];
  const lines = PACKS.map((p): PackRowLine => {
    const place = folder?.packs[p.id];
    const base = { id: p.id, title: p.title, does: p.does, forWhat: p.forWhat, cost: p.cost, measured: p.measured };
    const why = recommended.find((r) => r.id === p.id)?.why ?? null;
    if (folder?.blocked) return { ...base, checked: false, disabled: true, note: null, recommended: null };
    switch (place?.state) {
      case 'installed':
        return { ...base, checked: true, disabled: true, note: "Already in this folder's .claude/.", recommended: null };
      case 'edited':
        return { ...base, checked: true, disabled: true, note: "In this folder's .claude/, edited. Worklings leaves it as it is.", recommended: null };
      case 'partial':
        return { ...base, checked: false, disabled: true, note: "Partly removed from this folder's .claude/. Worklings leaves it as it is.", recommended: null };
      case 'conflict':
        return { ...base, checked: false, disabled: true, note: `This folder has its own .claude/${place.file ?? ''}, so the pack would replace it.`, recommended: null };
      default:
        return { ...base, checked: chosen.includes(p.id), disabled: false, note: null, recommended: why };
    }
  });
  return { blocked: folder?.blocked ?? null, lines, lead: PACKS_LEAD };
}

/** What Start sends: the ticked packs the folder can take, in catalogue order. */
export function packsToSend(chosen: readonly PackId[], folder: FolderPacks | null): PackId[] {
  return PACKS.map((p) => p.id).filter((id) => chosen.includes(id) && addable(folder, id));
}
