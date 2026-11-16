// The hub's first-run routes (src/hub/setup-routes.ts): Claude Code's status, and the consent step for watching a
// project. Separate from HubActions because the demo has none of this.
import { exchange, refusal } from '../api.ts';
import { asSetup, asWatchPlan, type SetupView, type WatchPlan, type WatchResult } from './setupModel.ts';

/** Claude Code's status; `fresh` checks again (after the person signed in, say) instead of answering from the hub's memory. */
export async function fetchSetup(token: string | null, fresh = false): Promise<SetupView> {
  const answer = await exchange(`/api/setup${fresh ? '?fresh=1' : ''}`, token);
  if (!answer.ok) throw refusal(answer.status, answer.body);
  return asSetup(answer.body);
}

/** What watching the folder would write, before anything is. */
export async function fetchWatchPlan(token: string | null, folder: string): Promise<WatchPlan> {
  const answer = await exchange(`/api/watch?folder=${encodeURIComponent(folder)}`, token);
  if (!answer.ok) throw refusal(answer.status, answer.body);
  return asWatchPlan(answer.body);
}

/** Writes the hooks, which the hub does only with consent: true. */
export async function installWatch(token: string | null, folder: string, port: number): Promise<WatchResult> {
  const answer = await exchange('/api/watch', token, { body: { folder, consent: true, port } });
  if (!answer.ok) throw refusal(answer.status, answer.body);
  return asWatchPlan(answer.body);
}
