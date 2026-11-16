// Controls for replaying a past session: which session, play, pause, speed and where in the session we are.
import { useEffect, useState } from 'react';
import type { ReplayInfo, SessionSummary } from '../../../src/core/snapshot.ts';
import { controlReplay, getSessions } from '../lib/api.ts';
import { duration } from '../lib/format.ts';

const SPEEDS = [1, 4, 16, 60, 240, 600];

export function Replay({ replay, token }: { replay: ReplayInfo; token: string | null }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    getSessions(token).then(setSessions, () => setSessions([]));
  }, [token]);
  const span = Math.max(1, replay.endedAt - replay.startedAt);
  const done = Math.min(span, Math.max(0, replay.position - replay.startedAt));
  const send = (body: Parameters<typeof controlReplay>[1]) => {
    controlReplay(token, body).then(
      () => setProblem(null),
      (error: unknown) => setProblem(error instanceof Error ? error.message : 'The office did not answer. Is it still running?'),
    );
  };
  return (
    <section className="replay" aria-label="Replay controls">
      {sessions.length > 1 ? (
        <div className="field">
          <label className="field__label" htmlFor="replay-session">Session</label>
          <select id="replay-session" value={replay.sessionId} onChange={(e) => send({ session: e.target.value })}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}, {new Date(s.startedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="replay__title">{replay.title}</p>
      )}
      <div className="replay__bar" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(span / 1000)} aria-valuenow={Math.round(done / 1000)} aria-valuetext={`${duration(done)} of ${duration(span)}`}>
        <span style={{ width: `${(done / span) * 100}%` }} />
      </div>
      <div className="replay__controls">
        <button type="button" className="button" onClick={() => send({ play: !replay.playing })}>{replay.playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="button" onClick={() => send({ restart: true })}>Start over</button>
        <div className="field field--inline">
          <label className="field__label" htmlFor="replay-speed">Speed</label>
          <select id="replay-speed" value={replay.speed} onChange={(e) => send({ speed: Number(e.target.value) })}>
            {[...new Set([...SPEEDS, replay.speed])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
        </div>
        <span className="replay__time">{duration(done)} of {duration(span)}</span>
      </div>
      {problem && <p className="replay__problem" role="alert">{problem}</p>}
    </section>
  );
}
