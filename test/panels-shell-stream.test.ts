// The hub's event streams (web/src/company/stream.ts, which useHub.ts holds in a component) against a fake EventSource
// and fetch: how the connection stands, what each refusal means, a burst of errors coming back as one new stream, the
// clocks measured from the first view, and a stream closed while the tab is out of sight.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_STREAM, openStream, RETRY_MS, type Stream, type StreamSource } from '../web/src/company/stream.ts';

interface View {
  serverTime: number;
  n: number;
}
const isView = (v: unknown): v is View => typeof v === 'object' && v !== null && 'serverTime' in v && typeof v.serverTime === 'number' && 'n' in v && typeof v.n === 'number';

/** 14:00 on 5 Nov 2026, local time, by this browser's clock. */
const NOW = new Date(2026, 10, 5, 14, 0, 0).getTime();
const view = (n: number, serverTime = NOW): View => ({ serverTime, n });
const SOURCE: StreamSource<View> = { url: '/events/c/plant-pal?token=tok', check: '/api/c/plant-pal/state', token: 'tok', event: 'snapshot', guard: isView };
const CLOSED = 2;

/** EventSource as browsers have it, driven by the test: the hub sends a view, the line drops, EventSource gives up. */
function fakeEventSources() {
  const made: FakeSource[] = [];
  class FakeSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = CLOSED;
    readonly url: string;
    readyState = FakeSource.CONNECTING;
    constructor(url: string) {
      super();
      this.url = url;
      made.push(this);
    }
    close() {
      this.readyState = FakeSource.CLOSED;
    }
    send(value: unknown, event = 'snapshot') {
      this.readyState = FakeSource.OPEN;
      this.dispatchEvent(new MessageEvent(event, { data: typeof value === 'string' ? value : JSON.stringify(value) }));
    }
    /** The line drops: EventSource tries again by itself, or it gave up (the hub answered with no stream). */
    drop(gaveUp: boolean) {
      this.readyState = gaveUp ? FakeSource.CLOSED : FakeSource.CONNECTING;
      this.dispatchEvent(new Event('error'));
    }
  }
  vi.stubGlobal('EventSource', FakeSource);
  return made;
}

/** The hub's JSON route for the same view: each check gets the next answer, and with none left, no answer at all. */
function fakeChecks(...answers: (Response | Promise<Response>)[]) {
  const asked: { url: string; auth: string | null }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    asked.push({ url, auth: new Headers(init.headers).get('authorization') });
    const answer = answers.shift();
    if (!answer) throw new TypeError('Failed to fetch');
    return answer;
  });
  return asked;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An answer the test gives when it wants to. */
function later() {
  let give: (r: Response) => void = () => undefined;
  const answer = new Promise<Response>((resolve) => {
    give = resolve;
  });
  return { answer, give };
}

function watch(from: Stream<View> = NO_STREAM) {
  const seen: Stream<View>[] = [];
  const close = openStream(SOURCE, from, (s) => seen.push(s));
  return { seen, latest: () => seen.at(-1) ?? from, close };
}

/** Lets the checks' answers land: their promises, and reading a body. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function sourceAt<T>(made: readonly T[], i: number): T {
  const source = made[i];
  if (source === undefined) throw new Error(`No stream ${i} was opened.`);
  return source;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a hub stream', () => {
  it('is live with each view, and keeps the last one standing while it reconnects', async () => {
    const made = fakeEventSources();
    const asked = fakeChecks(json(200, view(1)));
    const s = watch();
    const es = sourceAt(made, 0);
    es.send(view(1));
    expect(s.latest()).toMatchObject({ connection: 'live', data: view(1), receivedAt: NOW });
    vi.setSystemTime(NOW + 30_000);
    es.drop(false);
    expect(s.latest()).toMatchObject({ connection: 'reconnecting', data: view(1), receivedAt: NOW });
    await settle();
    // The hub is there, so it was the line: the view stands while EventSource gets back by itself.
    expect(asked).toEqual([{ url: '/api/c/plant-pal/state', auth: 'Bearer tok' }]);
    expect(s.latest()).toMatchObject({ connection: 'reconnecting', data: view(1) });
    es.send(view(2));
    expect(s.latest()).toMatchObject({ connection: 'live', data: view(2), receivedAt: NOW + 30_000 });
    expect(made).toHaveLength(1);
  });

  it('takes views from plain messages too, and ignores what is not a view', () => {
    const made = fakeEventSources();
    fakeChecks();
    const s = watch();
    const es = sourceAt(made, 0);
    es.send('{"serverTime": 1, ');
    es.send({ hello: 'there' });
    expect(s.seen).toEqual([]);
    es.send(view(1), 'message');
    expect(s.latest()).toMatchObject({ connection: 'live', data: view(1) });
  });

  it.each([401, 403])('locks the tab when the hub answers %i, and opens nothing again', async (status) => {
    const made = fakeEventSources();
    const asked = fakeChecks(json(status, { error: 'Open the office with the link the CLI printed: it carries the access token.' }));
    const s = watch();
    const es = sourceAt(made, 0);
    es.send(view(1));
    es.drop(true);
    await settle();
    expect(s.latest()).toMatchObject({ connection: 'locked', data: view(1) });
    expect(es.readyState).toBe(CLOSED);
    vi.advanceTimersByTime(RETRY_MS * 10);
    expect(made).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [404, { error: "That company isn't in the lobby any more.", code: 'gone' }, "That company isn't in the lobby any more."],
    [409, { error: "Its folder isn't at C:\\Users\\jamie\\plant-pal any more.", code: 'cannot-run' }, "Its folder isn't at C:\\Users\\jamie\\plant-pal any more."],
    [404, {}, "That company isn't in the lobby any more."],
  ])('is gone for good when the hub answers %i, with its sentence', async (status, body, refusal) => {
    const made = fakeEventSources();
    const asked = fakeChecks(json(status, body));
    const s = watch();
    const es = sourceAt(made, 0);
    es.drop(true);
    await settle();
    expect(s.latest()).toMatchObject({ connection: 'gone', refusal });
    expect(es.readyState).toBe(CLOSED);
    // No retry after gone, even with an error coming in late.
    es.drop(true);
    await settle();
    vi.advanceTimersByTime(RETRY_MS * 10);
    expect(made).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.latest().connection).toBe('gone');
  });

  it('answers a burst of errors with one check, one timer and one new stream', async () => {
    const made = fakeEventSources();
    const check = later();
    const asked = fakeChecks(check.answer);
    const s = watch();
    const es = sourceAt(made, 0);
    es.send(view(1));
    // EventSource tries again by itself, fails again, then gives up, all while the first check is out.
    es.drop(false);
    es.drop(false);
    es.drop(true);
    expect(asked).toHaveLength(1);
    check.give(json(200, view(1)));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(RETRY_MS - 1);
    expect(made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(made).toHaveLength(2);
    expect(sourceAt(made, 1).url).toBe(SOURCE.url);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.latest()).toMatchObject({ connection: 'reconnecting', data: view(1) });
    sourceAt(made, 1).send(view(2));
    expect(s.latest()).toMatchObject({ connection: 'live', data: view(2) });
  });

  it('opens the stream again when the check gets no answer either', async () => {
    const made = fakeEventSources();
    fakeChecks();
    watch();
    sourceAt(made, 0).drop(true);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(RETRY_MS);
    expect(made).toHaveLength(2);
  });
});

describe("the hub's clock against this browser's", () => {
  it('is measured on the first view, held while the stream is live, and measured again when it comes back', async () => {
    const made = fakeEventSources();
    fakeChecks(json(200, view(0)));
    const s = watch();
    const es = sourceAt(made, 0);
    // The hub's clock runs 90 s ahead of this phone's.
    es.send(view(1, NOW + 90_000));
    expect(s.latest().skew).toBe(90_000);
    // A later view took 40 ms longer on the way: the windows timed from the skew don't move with it.
    vi.setSystemTime(NOW + 5_000);
    es.send(view(2, NOW + 95_000 - 40));
    expect(s.latest().skew).toBe(90_000);
    // The line drops; when it is back, the phone's clock has been set right and runs 2 s ahead of the hub's.
    es.drop(false);
    await settle();
    vi.setSystemTime(NOW + 60_000);
    es.send(view(3, NOW + 58_000));
    expect(s.latest().skew).toBe(-2_000);
  });
});

describe('a stream closed while the tab is out of sight', () => {
  it('holds nothing open, a waiting retry included', async () => {
    const made = fakeEventSources();
    fakeChecks(json(200, view(1)));
    const s = watch();
    const es = sourceAt(made, 0);
    es.drop(true);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    s.close();
    expect(es.readyState).toBe(CLOSED);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(RETRY_MS * 10);
    expect(made).toHaveLength(1);
  });

  it('catches up when opened again: the last view stands until the first new one', () => {
    const made = fakeEventSources();
    fakeChecks();
    const before = watch();
    sourceAt(made, 0).send(view(1, NOW + 90_000));
    before.close();
    const again = watch(before.latest());
    expect(made).toHaveLength(2);
    expect(again.seen).toEqual([]);
    vi.setSystemTime(NOW + 120_000);
    sourceAt(made, 1).send(view(2, NOW + 120_000 + 90_000));
    expect(again.latest()).toMatchObject({ connection: 'live', data: view(2, NOW + 210_000), receivedAt: NOW + 120_000, skew: 90_000 });
  });
});
