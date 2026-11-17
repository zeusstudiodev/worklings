// The banner over a replayed run (SPEC-v0.8.md, "The demo replay"): it says this is a recording of which words, how much
// faster it plays and what it cost for real, tells the visitor when the run waits on them, and offers Skip to the end and
// Watch again.
import { useSyncExternalStore } from 'react';
import { demoHub } from '../demo.ts';
import { dollars } from '../../lib/format.ts';
import { duration } from './replayModel.ts';
import './replay.css';

export function ReplayBanner({ companyId }: { companyId: string }) {
  const hub = demoHub();
  // One string per state, so the store's value only changes when the banner's words do.
  const key = useSyncExternalStore(hub.subscribe, () => {
    const s = hub.replayOf(companyId)?.status();
    return s ? `${s.state}:${s.deniedOnce ? 1 : 0}` : '';
  });
  const player = hub.replayOf(companyId);
  if (!player || key === '') return null;
  const [state, denied] = key.split(':');
  const r = player.recording;
  const real = `${duration(r.durationMs)} and ${dollars(r.costUsd)} on ${r.model}`;
  const line =
    state === 'waiting'
      ? 'Claude Code waits for your answer on the card below.'
      : state === 'done'
        ? `That was the whole run: ${real}. Its last words are on the card.`
        : `A real Claude Code session from an empty folder: ${real} when it ran.`;
  const words = r.prompt.length > 90 ? `${r.prompt.slice(0, 87).trimEnd()}…` : r.prompt;
  return (
    <aside className={`replay-banner replay-banner--${state}`} aria-label="Recorded run">
      <p className="replay-banner__title">Recorded run, sped up ×{player.speed}</p>
      <p className="replay-banner__words" title={r.prompt}>
        “{words}”
      </p>
      <p className="replay-banner__line" role="status">
        {line}
        {denied === '1' && ' In the recorded run the prompt was allowed, so the replay carries on as it did.'}
      </p>
      <div className="replay-banner__keys">
        {state !== 'done' && (
          <button type="button" className="replay-banner__key" onClick={() => player.skipToEnd()}>
            Skip to the end
          </button>
        )}
        <button type="button" className="replay-banner__key" onClick={() => void hub.startReplay()}>
          {state === 'done' ? 'Watch again' : 'Start over'}
        </button>
      </div>
    </aside>
  );
}
