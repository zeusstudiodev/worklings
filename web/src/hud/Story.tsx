// The story: what happened in the studio as milestones in outcome words, newest first (docs/design.md, "The story").
// The Story tab tells it for everyone; a badge's Recent work tells the lines about the people on the badge.
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { type StoryPerson, storyLines } from '../../../src/core/story.ts';
import type { Selection } from '../scene/Building.tsx';
import { hourMinute } from '../lib/format.ts';
import { personHue } from './model.ts';

interface Props {
  snapshot: Snapshot;
  onSelect: (s: Selection) => void;
  /** A badge's people (agent keys): only their lines, and their own names aren't buttons, since the badge is theirs. */
  people?: ReadonlySet<string>;
}

export function Story({ snapshot, onSelect, people }: Props) {
  const lines = storyLines(snapshot, people);
  if (lines.length === 0) {
    return <p className="rows__empty">{people ? 'Nothing recent to tell.' : 'Nothing to tell yet. Requests, briefs, reports and questions show up here as they happen.'}</p>;
  }
  const agents = new Map(snapshot.agents.map((a) => [a.key, a]));
  const name = (p: StoryPerson) => {
    const agent = p.key !== null && !people?.has(p.key) ? agents.get(p.key) : undefined;
    if (!agent) return <span className="story__name">{p.name}</span>;
    return (
      <button type="button" className="link story__name" onClick={() => onSelect(agent.roleId ? { kind: 'role', id: agent.roleId } : { kind: 'agent', key: agent.key })}>
        {p.name}
      </button>
    );
  };
  return (
    <ol className="story">
      {lines.map((l) => {
        const agent = l.who.key !== null ? agents.get(l.who.key) : undefined;
        const hue = l.type === 'asked' ? 'var(--ink)' : agent ? personHue(snapshot, agent) : '#8C948F';
        return (
          <li key={l.id} className={`story__line story__line--${l.type}`} style={{ ['--hue' as string]: hue }}>
            <span className="story__marker" aria-hidden="true" />
            <p className="story__head">
              {name(l.who)} {l.did}
              {l.whom && <> {name(l.whom)}</>}
            </p>
            {l.about && <p className="story__about">{l.about}</p>}
            <time className="story__time" dateTime={new Date(l.at).toISOString()}>{hourMinute(l.at)}</time>
          </li>
        );
      })}
    </ol>
  );
}
