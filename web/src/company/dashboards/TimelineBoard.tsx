// The Timeline dashboard (docs/design-v3.md, "Dashboards"): v2's story lines with status lines, reports and decisions,
// newest first under hour headings ("14:00", then "Yesterday", "Mon 3 Nov"). One person's status lines in an hour fold
// into the latest ("and 5 earlier updates"). "Who" picks everyone, a room or a person; "Status lines" hides them. The
// lines are timeline()'s sentences, never a tool call, shown as text; nothing here is live for screen readers.
import { useId, useMemo, useState } from 'react';
import { timeline } from '../../../../src/core/boards.ts';
import { STAKEHOLDER, THE_OFFICE } from '../../../../src/core/company.ts';
import { roomHue } from '../../hud/model.ts';
import { hourMinute } from '../../lib/format.ts';
import type { TabProps } from '../types.ts';
import {
  earlierWords,
  EVERYONE,
  filterTimeline,
  pageGroups,
  TIMELINE_PAGE,
  type TimelineFilter,
  timelineEmpty,
  timelineGroups,
  type TimelineLine,
  whoChoices,
  whoInSentence,
} from './boardsModel.ts';
import { roomsOf } from './parts.tsx';

interface Props {
  props: TabProps;
  now: number;
  filter: TimelineFilter;
  onFilter: (filter: TimelineFilter) => void;
}

export function TimelineBoard({ props, now, filter, onFilter }: Props) {
  const { snapshot, company } = props;
  const id = useId();
  const [limit, setLimit] = useState(TIMELINE_PAGE);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const entries = useMemo(() => timeline(company), [company]);
  const kept = useMemo(() => filterTimeline(entries, filter, company.people), [entries, filter, company.people]);
  const groups = useMemo(() => timelineGroups(kept, now), [kept, now]);
  const page = pageGroups(groups, limit);
  const rooms = roomsOf(snapshot);
  const choices = whoChoices(company.people, rooms);
  const roomOf = new Map(company.people.map((p) => [p.id, p.room]));
  // A filter that names a room or person no longer here falls back to everyone.
  const whoValue = filter.who === EVERYONE || [...choices.rooms, ...choices.people].some((c) => c.value === filter.who) ? filter.who : EVERYONE;

  const hueOf = (person: string) => {
    if (person === STAKEHOLDER) return 'var(--ink)';
    if (person === THE_OFFICE) return '#8c948f';
    const room = roomOf.get(person);
    return room ? roomHue(snapshot, room) : '#8c948f';
  };

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const line = ({ entry, earlier }: TimelineLine) => {
    const unfolded = open.has(entry.id);
    return (
      <li key={entry.id} className={`story__line board-timeline__line board-timeline__line--${entry.kind}`} style={{ ['--hue' as string]: hueOf(entry.person) }}>
        <span className="story__marker" aria-hidden="true" />
        <p className="story__head">{entry.text}</p>
        <time className="story__time" dateTime={new Date(entry.at).toISOString()}>
          {hourMinute(entry.at)}
        </time>
        {earlier.length > 0 && (
          <div className="board-timeline__fold">
            <button type="button" className="link board-timeline__more" aria-expanded={unfolded} onClick={() => toggle(entry.id)}>
              {unfolded ? 'Hide the earlier updates' : earlierWords(earlier.length)}
            </button>
            {unfolded && (
              <ol className="board-timeline__earlier">
                {earlier.map((e) => (
                  <li key={e.id}>
                    <span>{e.text}</span>
                    <time className="board-timeline__time" dateTime={new Date(e.at).toISOString()}>
                      {hourMinute(e.at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="board board--timeline db-split">
      <h3 className="visually-hidden">Timeline</h3>
      {entries.length > 0 && (
        <div className="board-timeline__filters db-card db-split__side" role="group" aria-label="Filter the timeline">
          <label className="board-timeline__who">
            <span className="board-head__label">Who</span>
            <select value={whoValue} onChange={(e) => onFilter({ ...filter, who: e.target.value })} data-focus="dashboards:who">
              <option value={EVERYONE}>Everyone</option>
              {choices.rooms.length > 0 && (
                <optgroup label="Rooms">
                  {choices.rooms.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="People">
                {choices.people.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="board-timeline__status">
            <input type="checkbox" checked={filter.status} onChange={(e) => onFilter({ ...filter, status: e.target.checked })} />
            Status lines
          </label>
        </div>
      )}
      <div className="db-card db-split__list">
        {page.groups.length === 0 ? (
          <p className="board-empty">{timelineEmpty(entries.length, { ...filter, who: whoValue }, whoInSentence(whoValue, company.people, rooms))}</p>
        ) : (
          page.groups.map((g) => (
            <section key={g.key} className="board-timeline__group" aria-labelledby={`${id}-${g.key}`}>
              <h4 id={`${id}-${g.key}`} className="board-timeline__hour">
                {g.heading}
              </h4>
              <ol className="story board-timeline__lines">{g.lines.map(line)}</ol>
            </section>
          ))
        )}
        {page.more > 0 && (
          <button type="button" className="button board-timeline__page" onClick={() => setLimit((l) => l + TIMELINE_PAGE)}>
            Show {Math.min(page.more, TIMELINE_PAGE)} earlier lines
          </button>
        )}
      </div>
    </div>
  );
}
