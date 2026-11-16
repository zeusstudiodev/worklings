// One of the hub's event streams without React (useHub.ts holds one in a component): its latest view and how the
// connection stands. EventSource retries by itself; when it fails, the same view as JSON (`check`) tells a refusal from
// a dropped line: 401 or 403 locks the tab, 404 or 409 is for good, and anything else, or no answer, opens the stream
// again RETRY_MS after EventSource gave up. One check runs at a time and one retry waits at a time, so a burst of errors
// opens one new stream, and nothing opens again after a refusal.

/**
 * connecting: no answer yet. reconnecting: the last view stands while the stream retries. paused: closed while the tab
 * is out of sight, the last view standing. locked: no access link. gone: refused for good.
 */
export type HubConnection = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'locked' | 'gone';

export interface Stream<T> {
  data: T | null;
  connection: HubConnection;
  /** When (by this browser's clock) the latest data arrived. */
  receivedAt: number;
  /** For gone: the hub's sentence ("That company isn't in the lobby any more.", a company's problem). */
  refusal: string | null;
  /**
   * How far the hub's clock runs ahead of this browser's, in ms (negative when it runs behind): the first view's
   * `serverTime` against when it arrived, measured again each time the stream comes back and held in between. A time the
   * hub stamped minus the skew is a time on this browser's clock, which timers and Undo windows run on.
   */
  skew: number;
}

export const NO_STREAM: Stream<never> = { data: null, connection: 'connecting', receivedAt: 0, refusal: null, skew: 0 };

export interface StreamSource<T> {
  /** The event stream, with the token in its query: EventSource sends no headers. */
  url: string;
  /** The same view as JSON (`/api/lobby`, `/api/c/<id>/state`), asked when the stream fails. */
  check: string;
  token: string | null;
  /** The event the view comes in ("lobby", "snapshot"); plain messages count too. */
  event: string;
  guard: (v: unknown) => v is T;
}

/** How long after EventSource gave up the stream opens again. */
export const RETRY_MS = 2_000;
/** A check that hasn't answered in this long counts as no answer, so it can't hold the next retry back. */
export const CHECK_MS = 10_000;

const GONE = "That company isn't in the lobby any more.";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Opens `source` and reports every change to `onChange`. It starts from `from`: a view from before (the tab was out of
 * sight) stands until the first new one arrives. Returns what closes it.
 */
export function openStream<T extends { serverTime: number }>(source: StreamSource<T>, from: Stream<T>, onChange: (stream: Stream<T>) => void): () => void {
  // An earlier view doesn't count as live, so the first new one measures the clocks again.
  let state: Stream<T> = { ...from, connection: from.data ? 'reconnecting' : 'connecting', refusal: null };
  let es: EventSource | null = null;
  let stopped = false;
  /** Locked or gone: nothing opens again. */
  let refused = false;
  let checking = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<Stream<T>>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const onView = (e: Event) => {
    if (stopped || !(e instanceof MessageEvent) || typeof e.data !== 'string') return;
    let value: unknown;
    try {
      value = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!source.guard(value)) return;
    const now = Date.now();
    set({ data: value, connection: 'live', receivedAt: now, refusal: null, skew: state.connection === 'live' ? state.skew : value.serverTime - now });
  };

  const refuse = (connection: 'locked' | 'gone', refusal: string | null) => {
    refused = true;
    es?.close();
    set({ connection, refusal });
  };

  /** EventSource tries again by itself unless it gave up (the hub answered with something other than a stream). */
  const retryIfClosed = () => {
    if (stopped || refused || retry !== null || es?.readyState !== EventSource.CLOSED) return;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, RETRY_MS);
  };

  const onError = () => {
    if (stopped || refused) return;
    if (state.connection !== 'reconnecting') set({ connection: 'reconnecting' });
    // The check reads how the stream stands when it answers, which covers the errors that come in the meantime.
    if (checking) return;
    checking = true;
    // `cache` is the browser's: Node's types for fetch, which the tests run on, leave it out.
    const init: RequestInit & { cache?: string } = { headers: source.token ? { authorization: `Bearer ${source.token}` } : {}, cache: 'no-store', signal: AbortSignal.timeout(CHECK_MS) };
    fetch(source.check, init)
      .then(async (res) => {
        if (stopped || refused) return;
        if (res.status === 401 || res.status === 403) return refuse('locked', null);
        if (res.status === 404 || res.status === 409) {
          const body: unknown = await res.json().catch(() => null);
          if (!stopped) refuse('gone', isObj(body) && typeof body.error === 'string' ? body.error : GONE);
          return;
        }
        retryIfClosed();
      })
      .catch(() => retryIfClosed())
      .finally(() => {
        checking = false;
      });
  };

  const open = () => {
    if (stopped || refused) return;
    es?.close();
    es = new EventSource(source.url);
    es.addEventListener(source.event, onView);
    es.addEventListener('message', onView);
    es.addEventListener('error', onError);
  };

  open();
  return () => {
    stopped = true;
    es?.close();
    if (retry !== null) clearTimeout(retry);
  };
}
