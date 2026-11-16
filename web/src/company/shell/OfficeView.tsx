// The office as the main view (docs/design-v3.md, "The shell", "The office view"; design-hud, "The office view"): the
// caption at its top left, v2's headline, whose first sentence links to the inbox when something needs you, and the map
// keys at its top right: Fit, Zoom in, Zoom out and Full screen where the browser has it. Phones have neither: the inbox
// starts with the headline, and the keys are in the Company menu.
import type { MouseEvent } from 'react';
import type { CompanyView } from '../../../../src/core/company.ts';
import { useFullscreenElement } from '../../lib/fullscreen.ts';
import { headline } from '../now/nowModel.ts';
import { Icon } from './Icon.tsx';

export function Caption({ company, now, state, inboxHref, onInbox, onRaise }: { company: CompanyView; now: number; state: string; inboxHref: string; onInbox: () => void; onRaise?: () => void }) {
  const head = headline(company, now, state);
  if (!head.needs && head.rest.length === 0) return null;
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onInbox();
  };
  return (
    <p className="shell-caption">
      {head.needs && (
        <>
          <a className="shell-caption__needs" href={inboxHref} onClick={follow}>
            {head.needs}
          </a>{' '}
        </>
      )}
      {head.rest.join(' ')}
      {onRaise && company.pause?.reason === 'budget' && (
        <>
          {' '}
          <button type="button" className="link" onClick={onRaise}>
            Raise the budget
          </button>
        </>
      )}
    </p>
  );
}

export function MapKeys({ fullscreenable, onFit, onZoom, onFullScreen }: { fullscreenable: boolean; onFit: () => void; onZoom: (direction: 1 | -1) => void; onFullScreen: () => void }) {
  const full = useFullscreenElement() !== null;
  return (
    <div className="shell-mapkeys">
      {/* Zoom out, Zoom in and Fit, one tile: pinching isn't the only way to zoom (WCAG 2.5.1), and Fit says its word. */}
      <div className="shell-mapkeys__tile" role="group" aria-label="The office's camera">
        <button type="button" className="shell-mapkey shell-mapkey--icon" aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(-1)}>
          <Icon name="minus" size={16} />
        </button>
        <button type="button" className="shell-mapkey shell-mapkey--icon" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(1)}>
          <Icon name="plus" size={16} />
        </button>
        <button type="button" className="shell-mapkey" aria-label="Fit the office in view" onClick={onFit}>
          <Icon name="fit" size={16} />
          Fit
        </button>
      </div>
      {fullscreenable && (
        <button type="button" className="shell-mapkey shell-mapkey--standing" onClick={onFullScreen}>
          <Icon name={full ? 'exitFull' : 'full'} size={16} />
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      )}
    </div>
  );
}
