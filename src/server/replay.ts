// Replays a past Claude Code session of this project from its transcripts, at a chosen speed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { closingQuestion, type OfficeEvent, shownText } from '../core/events.ts';
import { emptyOffice } from '../core/office.ts';
import type { SessionSummary } from '../core/snapshot.ts';
import { finalReport, replayEvents } from '../core/transcript.ts';
import { claudeHome, type Office } from './office.ts';

export type { SessionSummary };

/** Earliest and latest of many numbers, without spreading them into Math.min (long sessions have too many). */
function span(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/** Claude Code keeps a project's transcripts in a folder named after its path, every non-alphanumeric character a "-". */
export function transcriptDir(root: string, home = claudeHome()): string {
  return join(home, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
}

function firstPrompt(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; isMeta?: boolean; message?: { content?: unknown } };
      const content = entry.message?.content;
      if (entry.type === 'user' && !entry.isMeta && typeof content === 'string' && !content.trimStart().startsWith('<')) return shownText(content, 80);
    } catch {
      // a line that isn't JSON is skipped, like the transcript reader does
    }
  }
  return null;
}

export function listSessions(root: string, dir = transcriptDir(root)): SessionSummary[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const path = join(dir, f);
      const id = f.slice(0, -'.jsonl'.length);
      const stat = statSync(path);
      const text = readFileSync(path, 'utf8');
      const times = [...text.matchAll(/"timestamp":"([^"]+)"/g)].map((m) => Date.parse(m[1] ?? '')).filter(Number.isFinite);
      const [first, last] = span(times);
      const subDir = join(dir, id, 'subagents');
      return {
        id,
        title: firstPrompt(text) ?? `Session ${id.slice(0, 8)}`,
        startedAt: times.length > 0 ? first : stat.birthtimeMs,
        endedAt: times.length > 0 ? last : stat.mtimeMs,
        subagents: existsSync(subDir) ? readdirSync(subDir).filter((s) => s.endsWith('.jsonl')).length : 0,
      };
    })
    .filter((s) => s.endedAt > s.startedAt)
    .sort((a, b) => b.endedAt - a.endedAt);
}

/** Every office event of a session and its subagents, in time order, with subagent arrivals and departures added. */
export function sessionEvents(root: string, sessionId: string, dir = transcriptDir(root)): OfficeEvent[] {
  const main = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(main)) throw new Error(`No transcript for session ${sessionId} in ${dir}`);
  const events = replayEvents(readFileSync(main, 'utf8'), { sessionId, cwd: root, fallbackTime: 0 });
  const subDir = join(dir, sessionId, 'subagents');
  if (existsSync(subDir)) {
    for (const file of readdirSync(subDir).filter((f) => f.endsWith('.jsonl'))) {
      const agentId = file.slice('agent-'.length, -'.jsonl'.length);
      const metaPath = join(subDir, `agent-${agentId}.meta.json`);
      let agentType = 'agent';
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { agentType?: unknown };
        if (typeof meta.agentType === 'string') agentType = meta.agentType;
      }
      const text = readFileSync(join(subDir, file), 'utf8');
      const own = replayEvents(text, { sessionId, agentId, agentType, cwd: root, fallbackTime: 0 }).filter((e) => e.kind !== 'prompt');
      const timed = own.filter((e) => e.at > 0);
      if (timed.length === 0) continue;
      const [start, end] = span(timed.map((e) => e.at));
      // The report it ended on, as the SubagentStop hook would have carried it.
      const report = finalReport(text);
      const question = report ? closingQuestion(report) : undefined;
      const said = report ? { lastMessage: shownText(report, 200), ...(question ? { question } : {}) } : {};
      events.push({ kind: 'subagent-start', at: start - 1, sessionId, agentId, agentType }, ...own, { kind: 'subagent-stop', at: end + 1, sessionId, agentId, agentType, ...said });
    }
  }
  const timed = events.filter((e) => e.at > 0).sort((a, b) => a.at - b.at);
  const last = timed.at(-1);
  if (last) timed.push({ kind: 'turn-end', at: last.at + 1, sessionId, failed: false });
  return timed;
}

/** Session time longer than this with nothing happening is skipped, keeping a short beat of it. */
const MAX_SILENCE_MS = 30_000;
const SILENCE_KEPT_MS = 2_000;

/** Plays events into the office as if they were happening now, faster or slower. */
export class ReplayPlayer {
  private events: OfficeEvent[] = [];
  private index = 0;
  private position = 0;
  private lastTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private office: Office;
  private root: string;
  speed = 4;
  playing = false;
  sessionId: string | null = null;
  title = '';

  constructor(office: Office, root: string) {
    this.office = office;
    this.root = root;
  }

  load(sessionId: string, title: string) {
    this.events = sessionEvents(this.root, sessionId);
    if (this.events.length === 0) throw new Error('That session has no events to replay.');
    this.sessionId = sessionId;
    this.title = title;
    this.restart();
  }

  restart() {
    this.office.state = emptyOffice();
    this.index = 0;
    this.position = this.events[0]?.at ?? 0;
    this.publish();
  }

  play(playing: boolean) {
    // Play at the end starts the session over.
    if (playing && this.index >= this.events.length) this.restart();
    this.playing = playing;
    this.lastTick = Date.now();
    if (playing && !this.timer) this.timer = setInterval(() => this.tick(), 100);
    if (!playing && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.publish();
  }

  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed <= 0 || speed > 600) throw new Error('Speed must be between 0 and 600.');
    this.speed = speed;
    this.publish();
  }

  /** Advances the replay clock and applies every event whose time has come. Exposed for tests. */
  tick(now = Date.now()) {
    const elapsed = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    this.position += elapsed * this.speed;
    // Sessions sit idle for hours between prompts; jump over long silences instead of playing them.
    const next = this.events[this.index]?.at;
    if (next !== undefined && next - this.position > MAX_SILENCE_MS) this.position = next - SILENCE_KEPT_MS;
    while (this.index < this.events.length && (this.events[this.index]?.at ?? Infinity) <= this.position) {
      const event = this.events[this.index];
      if (event) this.office.ingest(event);
      this.index += 1;
    }
    if (this.index >= this.events.length) this.play(false);
    this.publish();
  }

  private publish() {
    const first = this.events[0]?.at ?? 0;
    const last = this.events.at(-1)?.at ?? first;
    this.office.replay = this.sessionId
      ? { sessionId: this.sessionId, title: this.title, startedAt: first, endedAt: last, position: Math.min(this.position, last), speed: this.speed, playing: this.playing }
      : null;
    this.office.markDirty();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
