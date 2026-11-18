// The start form's Add row (SPEC-v0.9.md, "The start form"): a group of checkboxes, one per pack, under "How the work
// runs" for a one-session job. The words are packRowModel.ts's.
import type { FolderPacks, PackId } from '../../../../src/core/packs.ts';
import { packRowView, packsToSend } from './packRowModel.ts';

interface PackRowProps {
  id: string;
  chosen: readonly PackId[];
  onChange: (next: PackId[]) => void;
  /** What the folder holds; null before it has been read. */
  folder: FolderPacks | null;
  /** The words in the box, for the recommendations. */
  words: string;
  demo: boolean;
}

export function PackRow({ id, chosen, onChange, folder, words, demo }: PackRowProps) {
  const view = packRowView(folder, words, chosen);
  const sending = packsToSend(chosen, folder);
  const toggle = (pack: PackId, on: boolean) => onChange(on ? [...chosen.filter((c) => c !== pack), pack] : chosen.filter((c) => c !== pack));
  return (
    <fieldset className="start__field start__work start__packs" aria-describedby={`${id}-lead`}>
      <legend className="start__label">Add</legend>
      <p id={`${id}-lead`} className="start__hint">
        {view.blocked ?? view.lead}
      </p>
      {view.lines.map((line) => (
        <label key={line.id} className={`start__choice start__pack${line.checked ? ' is-chosen' : ''}${line.disabled ? ' is-disabled' : ''}`}>
          <input
            type="checkbox"
            name={`${id}-${line.id}`}
            value={line.id}
            checked={line.checked}
            disabled={line.disabled}
            aria-labelledby={`${id}-${line.id}-title`}
            aria-describedby={`${line.recommended ? `${id}-${line.id}-badge ` : ''}${id}-${line.id}-does ${id}-${line.id}-cost ${id}-${line.id}-measured${line.note ? ` ${id}-${line.id}-note` : ''}`}
            onChange={(e) => toggle(line.id, e.target.checked)}
          />
          <span className="start__choice-text">
            <span className="start__choice-label">
              <span id={`${id}-${line.id}-title`}>{line.title}</span>
              {line.recommended && (
                <span id={`${id}-${line.id}-badge`} className="start__pack-badge">
                  {' '}
                  Recommended: {line.recommended.charAt(0).toLowerCase() + line.recommended.slice(1)}
                </span>
              )}
            </span>
            <span id={`${id}-${line.id}-does`} className="start__choice-note">
              {line.does}
            </span>
            <span id={`${id}-${line.id}-cost`} className="start__choice-note start__pack-cost">
              {line.forWhat}. {line.cost}
            </span>
            <span id={`${id}-${line.id}-measured`} className="start__choice-note start__pack-measured">
              {line.measured}
            </span>
            {line.note && (
              <span id={`${id}-${line.id}-note`} className="start__choice-note start__pack-note">
                {line.note}
              </span>
            )}
          </span>
        </label>
      ))}
      {demo && sending.length > 0 && <p className="start__hint">The recorded run had no packs, so the demo replays it without them.</p>}
    </fieldset>
  );
}
