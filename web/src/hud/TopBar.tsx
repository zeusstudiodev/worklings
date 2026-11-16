import { totalTokens } from '../../../src/core/usage.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import type { Connection } from '../lib/api.ts';
import { dollars, rate, tokens } from '../lib/format.ts';

const MODE_TEXT = { live: 'Watching live', replay: 'Replay', demo: 'Demo' } as const;

/** The mark and the name, as every top bar starts; v3's Lobby link carries the mark alone (`name` false). */
export function Wordmark({ name = true }: { name?: boolean }) {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 20 20" aria-hidden="true" className="wordmark__mark">
        <circle cx="10" cy="6" r="4.2" />
        <path d="M3.5 19c0-4.3 2.9-7.2 6.5-7.2s6.5 2.9 6.5 7.2z" />
      </svg>
      {name && <span className="wordmark__text">Worklings</span>}
    </span>
  );
}

export function TopBar({ snapshot, connection, compact, onFit }: { snapshot: Snapshot; connection: Connection; compact: boolean; onFit: () => void }) {
  const { totals, burn } = snapshot;
  const used = totalTokens(totals.usage);
  const offline = connection !== 'live';
  return (
    <header className="topbar">
      <div className="topbar__id">
        <Wordmark />
        {!compact && <span className="topbar__project">{snapshot.project.name}</span>}
        <span className={`mode mode--${offline ? 'offline' : snapshot.mode}`} role="status">
          <span className="mode__dot" aria-hidden="true" />
          {offline ? (connection === 'locked' ? 'Needs the access link' : 'Reconnecting') : MODE_TEXT[snapshot.mode]}
        </span>
      </div>
      <dl className="ledger">
        {!compact && (
          <div className="ledger__item">
            <dt>At work</dt>
            <dd>{totals.active}</dd>
          </div>
        )}
        {!compact && (
          <div className="ledger__item">
            <dt>Tokens</dt>
            <dd>{tokens(used)}</dd>
          </div>
        )}
        <div className="ledger__item">
          <dt title={totals.costExact ? 'Reported by Claude Code telemetry' : `What the same tokens would cost on the Claude API, at list prices of ${snapshot.pricesAsOf}`}>
            {totals.costExact ? 'Spend' : 'API-equivalent'}
          </dt>
          <dd>{dollars(totals.cost)}</dd>
        </div>
        {!compact && (
          <div className="ledger__item">
            <dt>Burn, last 5 min</dt>
            <dd>{rate(burn.dollarsPerHour)}</dd>
          </div>
        )}
      </dl>
      <button type="button" className="icon-button topbar__fit" onClick={onFit} aria-label="Fit the whole studio in view" title="Fit the studio in view">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
        </svg>
      </button>
    </header>
  );
}
