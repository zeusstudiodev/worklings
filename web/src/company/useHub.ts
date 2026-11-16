// The hub's two live streams: the lobby (`/events/lobby`) and one company (`/events/c/<id>`), with the token the tab
// keeps (web/src/lib/token.ts) and v2's way of reconnecting: EventSource retries by itself, and when the hub refuses
// outright the tab finds out why (the access link, a company that left the lobby, one that can't run). stream.ts holds
// the connection; this holds it in a component.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CompanyView, LobbyView } from '../../../src/core/company.ts';
import type { Snapshot } from '../../../src/core/snapshot.ts';
import { keepToken } from '../lib/token.ts';
import { demoHub } from './demo.ts';
import { NO_STREAM, openStream, type Stream } from './stream.ts';

export type { HubConnection, Stream } from './stream.ts';

/** The token this tab keeps, without touching the address bar (the app took it from the link at start). */
export const tabToken = (): string | null => keepToken(sessionStorage, null);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isLobbyView(v: unknown): v is LobbyView {
  return isObj(v) && Array.isArray(v.companies) && isObj(v.hub) && typeof v.serverTime === 'number';
}

const isCompanyView = (v: unknown): v is CompanyView =>
  isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.phase === 'string' && Array.isArray(v.people) && Array.isArray(v.questions) && Array.isArray(v.approvals);

/** A company's snapshot: v2's office with the company in it. */
export function isCompanySnapshot(v: unknown): v is Snapshot & { company: CompanyView } {
  return isObj(v) && Array.isArray(v.agents) && typeof v.serverTime === 'number' && isObj(v.totals) && isObj(v.aside) && isCompanyView(v.company);
}

/**
 * One event stream, its latest data and how the connection stands. A new `url` starts over. `check` is the same view
 * as JSON (`/api/lobby`, `/api/c/<id>/state`), asked when the stream fails, to tell a refusal from a dropped line.
 * While `open` is false nothing is held open and the last view stands; opening again catches up from there.
 */
function useStream<T extends { serverTime: number }>(url: string, check: string, token: string | null, event: string, guard: (v: unknown) => v is T, open: boolean): Stream<T> {
  const [state, setState] = useState<{ url: string; stream: Stream<T> }>({ url, stream: NO_STREAM });
  // What the stream said last, so it picks up from there after a close.
  const last = useRef(state);
  useEffect(() => {
    if (!open) return;
    const was = last.current.url === url ? last.current.stream : NO_STREAM;
    return openStream({ url, check, token, event, guard }, was, (stream) => {
      last.current = { url, stream };
      setState(last.current);
    });
  }, [url, check, token, event, guard, open]);
  if (state.url !== url) return NO_STREAM;
  return open ? state.stream : { ...state.stream, connection: 'paused' };
}

const withToken = (path: string, token: string | null) => `${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

/** The hub's lobby, live. While `open` is false (a company tab out of sight) no stream is held and the last view stands. */
export function useLobby(token: string | null = tabToken(), open = true): Stream<LobbyView> {
  return useStream(withToken('/events/lobby', token), '/api/lobby', token, 'lobby', isLobbyView, open);
}

/** One company's snapshot, live. */
export function useCompany(id: string, token: string | null = tabToken()): Stream<Snapshot & { company: CompanyView }> {
  const company = encodeURIComponent(id);
  return useStream(withToken(`/events/c/${company}`, token), `/api/c/${company}/state`, token, 'snapshot', isCompanySnapshot, true);
}

const onVisibility = (change: () => void) => {
  document.addEventListener('visibilitychange', change);
  return () => document.removeEventListener('visibilitychange', change);
};

/** Whether this tab is in sight (`document.visibilityState`). */
export const usePageVisible = (): boolean => useSyncExternalStore(onVisibility, () => document.visibilityState === 'visible');

// ---------------------------------------------------------------------------------------------------------------
// The demo: the same shapes from the local demo hub, whose clock is this browser's

/** The demo lobby, changing as the demo's actions change it. */
export function useDemoLobby(): Stream<LobbyView> {
  const hub = demoHub();
  const lobby = useSyncExternalStore(hub.subscribe, hub.lobby);
  return { data: lobby, connection: 'live', receivedAt: hub.changedAt(), refusal: null, skew: 0 };
}

/** A demo company's snapshot; gone once it left the demo lobby. */
export function useDemoCompany(id: string): Stream<Snapshot & { company: CompanyView }> {
  const hub = demoHub();
  const snapshot = useSyncExternalStore(hub.subscribe, () => hub.snapshot(id));
  if (!snapshot) return { data: null, connection: 'gone', receivedAt: 0, refusal: "That company isn't in the lobby any more.", skew: 0 };
  return { data: snapshot, connection: 'live', receivedAt: hub.changedAt(), refusal: null, skew: 0 };
}
