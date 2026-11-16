import { describe, expect, it } from 'vitest';
import { crossSessionWords, normalizeHook } from '../src/core/events.ts';
import { replayEvents } from '../src/core/transcript.ts';

// A session started from another session gets its brief, and later messages, as prompts wrapped in a
// <cross-session-message> tag with the sender's ids. Seen 5 Nov 2026 in the watching office, which showed the wrapper.
const SESSION = '0f8a2c1e-5b7d-4e2a-9c3b-1d2e3f4a5b6c';
const wrapped = '<cross-session-message from="local_655fdb35-1b71-435b-8b8a-293d5faa36f8" from-name="Dynamic studio generator with gamified 3D">\nRobin said "go ahead with v3". Build it.\n</cross-session-message>';

describe('messages from another session', () => {
  it('reads the words out of the wrapper', () => {
    expect(crossSessionWords(wrapped)).toBe('Robin said "go ahead with v3". Build it.');
    expect(crossSessionWords('Plain prompt')).toBeNull();
    expect(crossSessionWords('<cross-session-message from="x"></cross-session-message>')).toBeNull();
    expect(crossSessionWords('<system-reminder>Not a message</system-reminder>')).toBeNull();
  });

  it('shows the words as the request in a live office, never the wrapper or its ids', () => {
    const event = normalizeHook({ hook_event_name: 'UserPromptSubmit', session_id: SESSION, cwd: 'C:/p', prompt: wrapped }, 1);
    expect(event).toMatchObject({ kind: 'prompt', notification: false, text: 'Robin said "go ahead with v3". Build it.' });
  });

  it('keeps the request in a replay, where tagged prompts were dropped', () => {
    const line = JSON.stringify({ type: 'user', sessionId: SESSION, timestamp: '2026-11-05T04:00:00.000Z', message: { role: 'user', content: wrapped } });
    const events = replayEvents(`${line}\n`, { sessionId: SESSION, fallbackTime: 0 });
    expect(events.find((e) => e.kind === 'prompt')).toMatchObject({ text: 'Robin said "go ahead with v3". Build it.' });
  });
});
