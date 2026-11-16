// Talks to the office server: the live snapshot stream and the JSON API.
import { useEffect, useState } from 'react';
import type { Digest } from '../../../src/core/aside.ts';
import type { ReshapeAction, ReshapeResult, SessionSummary, Snapshot, StudioCatalog } from '../../../src/core/snapshot.ts';
import { keepToken } from './token.ts';

/** Reads the token from the link the CLI printed, keeps it for this tab and takes it out of the address bar. */
export function takeToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  const token = keepToken(sessionStorage, fromUrl);
  if (fromUrl) {
    url.searchParams.delete('token');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return token;
}

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'locked';

/** The live snapshot, the connection, and when (by this browser's clock) the snapshot arrived. */
export function useOffice(token: string | null): { snapshot: Snapshot | null; connection: Connection; receivedAt: number } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [connection, setConnection] = useState<Connection>('connecting');
  useEffect(() => {
    const source = new EventSource(`/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    source.addEventListener('snapshot', (event) => {
      setSnapshot(JSON.parse((event as MessageEvent<string>).data) as Snapshot);
      setReceivedAt(Date.now());
      setConnection('live');
    });
    source.onerror = () => {
      setConnection('reconnecting');
      // EventSource retries by itself unless the server refused us outright; find out which.
      fetch(`/api/state${token ? `?token=${encodeURIComponent(token)}` : ''}`)
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            setConnection('locked');
            source.close();
          }
        })
        .catch(() => setConnection('reconnecting'));
    };
    return () => source.close();
  }, [token]);
  return { snapshot, connection, receivedAt };
}

export class ApiError extends Error {
  readonly status: number;
  /** The office's reason, when it gives one ("busy", "rate-limited", "unknown-agent"...). */
  readonly code: string | null;
  /** For "rate-limited": seconds until the office takes another call. */
  readonly retryAfter: number | null;
  constructor(status: number, message: string, code: string | null = null, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.body ? { 'content-type': 'application/json' } : {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const fields = body && typeof body === 'object' ? (body as { error?: unknown; code?: unknown; retryAfter?: unknown }) : {};
    const message = fields.error !== undefined ? String(fields.error) : `The office answered ${res.status}.`;
    const code = typeof fields.code === 'string' ? fields.code : null;
    const retryAfter = typeof fields.retryAfter === 'number' && Number.isFinite(fields.retryAfter) ? fields.retryAfter : null;
    throw new ApiError(res.status, message, code, retryAfter);
  }
  return body as T;
}

/**
 * Where v2's calls go when a caller names no base: "/api" for `worklings office`, replay and demo. A company's shell
 * points them at that company's copy ("/api/c/<id>") while it shows, so v2's Catch me up, Ask aside, room cards and
 * badges work there unchanged; the function it returns points them back.
 */
let defaultBase = '/api';
export function pointApiAt(base: string): () => void {
  const before = defaultBase;
  defaultBase = base;
  return () => {
    defaultBase = before;
  };
}

export const getCatalog = (token: string | null, base = defaultBase) => request<StudioCatalog>(`${base}/studio`, token);

export const reshape = (token: string | null, action: ReshapeAction, base = defaultBase) =>
  request<ReshapeResult>(`${base}/reshape`, token, { method: 'POST', body: JSON.stringify(action) });

export const getSessions = (token: string | null, base = defaultBase) => request<SessionSummary[]>(`${base}/sessions`, token);

export const controlReplay = (token: string | null, body: { session?: string; play?: boolean; speed?: number; restart?: boolean }, base = defaultBase) =>
  request<{ ok: boolean }>(`${base}/replay`, token, { method: 'POST', body: JSON.stringify(body) });

/** Ask aside: the answer arrives in a later snapshot (`snapshot.aside`), under the id this returns. */
export const ask = (token: string | null, agentKey: string, question: string, base = defaultBase) =>
  request<{ id: string }>(`${base}/ask`, token, { method: 'POST', body: JSON.stringify({ agentKey, question }) });

/** Catch me up: an id while the digest is written, or the "nothing new" digest straight away. */
export const catchUp = (token: string | null, base = defaultBase) => request<{ id: string } | Digest>(`${base}/catch-up`, token, { method: 'POST', body: '{}' });

/** Stops the running question or catch-up, if it is the one named. */
export const cancelAside = (token: string | null, id: string, base = defaultBase) =>
  request<{ cancelled: boolean }>(`${base}/aside/cancel`, token, { method: 'POST', body: JSON.stringify({ id }) });

/** Where a company's copy of v2's API lives on the hub. */
export const companyApiBase = (company: string): string => `/api/c/${encodeURIComponent(company)}`;
