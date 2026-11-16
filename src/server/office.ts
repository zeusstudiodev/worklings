// The running office: state, studio, transcript tails and the people watching it.
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type AsideView, CATCH_UP_WINDOW_MS, emptyAsideView, withOfficeSpend } from '../core/aside.ts';
import { normalizeHook, type OfficeEvent, shownText } from '../core/events.ts';
import {
  agentCost, apply, assignSession, burnRate, CONTRACTOR_LINGER_MS, emptyOffice, evict, indexStudio, leadKey, MEETING_MS, milestones, type OfficeState,
  relabel, type StudioIndex, sweep, totals,
} from '../core/office.ts';
import { PRICES_AS_OF } from '../core/pricing.ts';
import type { OfficeMode, ReplayInfo, Snapshot, StudioSource } from '../core/snapshot.ts';
import type { Studio } from '../core/studio.ts';
import { loadProjectStudio, studioFingerprint } from './project.ts';
import { TranscriptTail } from './tail.ts';

export type { OfficeMode, Snapshot };

/** Where Claude Code keeps its settings and transcripts. */
export const claudeHome = (): string => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

/** True when `path` is `root` or inside it (case-insensitive on Windows, any slash style). */
export function isInside(root: string, path: string): boolean {
  const norm = (p: string) => {
    const s = p.replaceAll('\\', '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  const r = norm(root);
  const p = norm(path);
  return p === r || p.startsWith(`${r}/`);
}

/** Milestones a snapshot carries for the story: the browser never shows the steps between them. */
const ACTIVITY_IN_SNAPSHOT = 120;
/** How long a tail keeps reading after its session or subagent stops: Claude Code can write the last line after the hook. */
const TAIL_GRACE_MS = 10_000;

export interface OfficeOptions {
  now?: () => number;
  /** Claude Code's config folder: transcripts are only ever read from its projects/ folder. */
  claudeHome?: string;
}

/** Ask aside and Catch me up for an office (src/server/aside.ts); runOffice attaches one in every mode. */
export interface AsideHost {
  view(): AsideView;
}

interface Follow {
  tail: TranscriptTail;
  sessionId: string;
  /** Set when the session or subagent stops: after this time, once caught up, the tail rests until it shows up again
   * (a resume writes on in the same file). */
  restAt: number | null;
  resting: boolean;
}

export class Office {
  state: OfficeState = emptyOffice();
  studio: Studio | null = null;
  studioSource: StudioSource = 'none';
  studioErrors: string[] = [];
  index: StudioIndex = indexStudio(null);
  lastHookAt: number | null = null;
  ignoredHooks = 0;
  /** Set by the replay player so the HUD can show its position and controls. */
  replay: ReplayInfo | null = null;
  aside: AsideHost | null = null;
  private fingerprint: string | null = null;
  /** v0.7: a studio kept in memory (a plain job's), which the folder's files never replace. */
  private pinned = false;
  private readonly tails = new Map<string, Follow>();
  /** Message ids counted per session, shared by its tails, so nothing is counted twice. */
  private readonly seen = new Map<string, Set<string>>();
  private readonly listeners = new Set<(snapshot: Snapshot) => void>();
  private dirty = true;
  readonly root: string;
  readonly name: string;
  readonly mode: OfficeMode;
  /** Claude Code's config folder, whose projects/ folder holds the transcripts. */
  readonly claudeDir: string;
  private readonly now: () => number;
  private readonly transcripts: string;

  constructor(root: string, name: string, mode: OfficeMode, options: OfficeOptions = {}) {
    this.root = root;
    this.name = name;
    this.mode = mode;
    this.now = options.now ?? Date.now;
    this.claudeDir = options.claudeHome ?? claudeHome();
    this.transcripts = join(this.claudeDir, 'projects');
  }

  /** Loads (or reloads) the studio from disk; returns true when it changed. */
  loadStudio(): boolean {
    if (this.pinned) return false;
    const fingerprint = studioFingerprint(this.root);
    if (fingerprint === this.fingerprint) return false;
    this.fingerprint = fingerprint;
    this.setStudio(loadProjectStudio(this.root));
    return true;
  }

  /** v0.7: draws this studio from now on, whatever the folder holds (a plain job writes no studio into its project). */
  pinStudio(studio: Studio) {
    this.pinned = true;
    this.setStudio({ studio, source: 'manifest', errors: [] });
  }

  setStudio(project: { studio: Studio | null; source: StudioSource; errors: string[] }) {
    this.studio = project.studio;
    this.studioSource = project.source;
    this.studioErrors = project.errors;
    this.index = indexStudio(project.studio);
    relabel(this.state, this.index);
    this.dirty = true;
  }

  /**
   * A hook payload from Claude Code. Returns false when the office doesn't show it: a replay or the demo, or a session
   * in another folder (or one that doesn't say where it runs).
   */
  ingestHook(payload: unknown): boolean {
    if (this.mode !== 'live') return false;
    const event = normalizeHook(payload, this.now());
    if (!event) return false;
    if (!event.cwd || !isInside(this.root, event.cwd)) {
      this.ignoredHooks += 1;
      return false;
    }
    this.lastHookAt = event.at;
    this.ingest(event);
    return true;
  }

  /**
   * v3: the session is a company's desk for `person` (a role id): its main agent is drawn as that person, in their room
   * with their title, instead of as a visitor. Other sessions in the folder stay visitors.
   */
  assignSession(sessionId: string, person: string): boolean {
    const changed = assignSession(this.state, sessionId, person, this.index);
    if (changed) this.dirty = true;
    return changed;
  }

  /**
   * A hook from one of the company's desks, whose token said who it is. A desk may work in a worktree outside the
   * project's folder, so its cwd isn't checked; the session is assigned to the person first.
   */
  ingestDeskHook(payload: unknown, person: string): boolean {
    if (this.mode !== 'live') return false;
    const event = normalizeHook(payload, this.now());
    if (!event) return false;
    // A desk speaks for its own session only: another person's stays theirs.
    const owner = this.state.assigned[event.sessionId];
    if (owner !== undefined && owner !== person) return false;
    this.assignSession(event.sessionId, person);
    this.lastHookAt = event.at;
    this.ingest(event);
    return true;
  }

  /**
   * v3: reads a desk session's transcript from now on, so the person's spend moves during their turn. A desk sends the
   * office no hook before its turn ends (Stop), so the hub names the file, where Claude Code writes it. False when the
   * path isn't a transcript the office may read, or the session is someone else's.
   */
  followDesk(sessionId: string, person: string, transcript: string): boolean {
    if (this.mode !== 'live' || !this.isTranscript(transcript)) return false;
    const owner = this.state.assigned[sessionId];
    if (owner !== undefined && owner !== person) return false;
    this.assignSession(sessionId, person);
    const entry = this.tail(transcript, sessionId);
    if (!entry) return false;
    entry.resting = false;
    entry.restAt = null;
    return true;
  }

  /**
   * v0.4 (SPEC-v0.4.md, H2): a helper a desk's person started with the Agent tool, as its subagent files show it
   * (`<session>/subagents/agent-<id>.meta.json` and `.jsonl`, which the hub finds): drawn beside their desk from its
   * start, its tokens read from its own transcript, and done once its file says it finished. The desk's SubagentStop
   * hook says the same when it comes first. False when the session isn't that person's or the path isn't a transcript.
   */
  followHelper(sessionId: string, person: string, helper: { agentId: string; agentType: string; description: string; finished: boolean; transcript: string }): boolean {
    if (this.mode !== 'live' || !this.isTranscript(helper.transcript) || this.state.assigned[sessionId] !== person) return false;
    const key = `${sessionId}:${helper.agentId}`;
    const known = this.state.agents[key];
    const at = this.now();
    if (!known && helper.finished) return false;
    if (!known) {
      this.ingest({ kind: 'subagent-start', at, sessionId, agentId: helper.agentId, agentType: helper.agentType });
      const a = this.state.agents[key];
      if (a && a.task === null && helper.description) a.task = shownText(helper.description, 200);
    }
    const entry = this.tail(helper.transcript, sessionId, { agentId: helper.agentId, agentType: helper.agentType });
    if (entry) {
      entry.resting = false;
      if (helper.finished) entry.restAt ??= at + TAIL_GRACE_MS;
    }
    const a = this.state.agents[key];
    if (helper.finished && a && a.endedAt === null) this.ingest({ kind: 'subagent-stop', at, sessionId, agentId: helper.agentId, agentType: helper.agentType });
    this.dirty = true;
    return true;
  }

  /** Whether the office reads a session's transcript, however it learned of it. */
  follows(sessionId: string): boolean {
    for (const entry of this.tails.values()) if (entry.sessionId === sessionId && !entry.resting) return true;
    return false;
  }

  /** The person's figure: the main agent of their most recently active desk session, once the office has seen it. */
  agentKeyOf(person: string): string | null {
    let best: { key: string; at: number } | null = null;
    for (const [sessionId, who] of Object.entries(this.state.assigned)) {
      if (who !== person) continue;
      const agent = this.state.agents[leadKey(sessionId)];
      if (agent && (best === null || agent.lastEventAt > best.at)) best = { key: agent.key, at: agent.lastEventAt };
    }
    return best?.key ?? null;
  }

  /**
   * What each person's desk sessions have spent so far by their transcripts, subagents included, as the top bar's
   * total counts it: it moves during a turn, before the turn's result says what the turn cost.
   */
  spentBy(): Map<string, number> {
    const spent = new Map<string, number>();
    for (const agent of Object.values(this.state.agents)) {
      const person = this.state.assigned[agent.sessionId];
      if (person !== undefined) spent.set(person, (spent.get(person) ?? 0) + agentCost(agent));
    }
    return spent;
  }

  /** Cost from OpenTelemetry. Claude Code exports it for every session in the shell, so only sessions the hooks
   * placed in this project count. */
  ingestCosts(events: OfficeEvent[]) {
    if (this.mode !== 'live') return;
    for (const event of events) if (this.state.sessions[event.sessionId]) this.ingest(event);
  }

  ingest(event: OfficeEvent) {
    apply(this.state, event, this.index);
    this.follow(event);
    this.dirty = true;
  }

  /** A transcript the office may read: a .jsonl file in Claude Code's projects folder, whatever a payload says. */
  isTranscript(path: string): boolean {
    return path.endsWith('.jsonl') && isInside(this.transcripts, resolve(path));
  }

  private tail(path: string, sessionId: string, agent?: { agentId: string; agentType: string }): Follow | null {
    if (!this.isTranscript(path)) return null;
    let entry = this.tails.get(path);
    if (!entry) {
      const seen = this.seen.get(sessionId) ?? new Set<string>();
      this.seen.set(sessionId, seen);
      const cwd = this.state.sessions[sessionId]?.cwd;
      const tail = new TranscriptTail(path, { sessionId, ...(cwd ? { cwd } : {}), ...(agent ?? {}) }, seen);
      entry = { tail, sessionId, restAt: null, resting: false };
      this.tails.set(path, entry);
    }
    return entry;
  }

  /** Starts (or resumes) reading the transcripts a session and its subagents write, so their tokens show up live. */
  private follow(e: OfficeEvent) {
    if (e.kind === 'usage' || e.kind === 'cost') return;
    const main = this.state.sessions[e.sessionId]?.transcriptPath;
    const sub = (agentId: string) => (main ? join(dirname(main), e.sessionId, 'subagents', `agent-${agentId}.jsonl`) : null);
    if (main) {
      const entry = this.tail(main, e.sessionId);
      if (entry && e.kind !== 'session-end') {
        entry.resting = false;
        entry.restAt = null;
      }
    }
    if (e.agentId && e.kind !== 'subagent-stop') {
      const path = sub(e.agentId);
      const entry = path ? this.tail(path, e.sessionId, { agentId: e.agentId, agentType: e.agentType ?? 'agent' }) : null;
      if (entry) {
        entry.resting = false;
        entry.restAt = null;
      }
    }
    if (e.kind === 'subagent-stop') {
      const path = e.agentTranscriptPath ?? sub(e.agentId);
      const entry = path ? this.tail(path, e.sessionId, { agentId: e.agentId, agentType: e.agentType }) : null;
      if (entry) entry.restAt ??= e.at + TAIL_GRACE_MS;
    }
    if (e.kind === 'session-end') {
      for (const entry of this.tails.values()) if (entry.sessionId === e.sessionId) entry.restAt ??= e.at + TAIL_GRACE_MS;
    }
  }

  /** Reads new transcript lines, retires quiet agents and reloads the studio if its files changed. */
  poll() {
    const now = this.now();
    for (const entry of this.tails.values()) {
      if (entry.resting) continue;
      const { events, more } = entry.tail.read(now);
      for (const event of events) apply(this.state, event, this.index);
      if (events.length > 0) this.dirty = true;
      if (entry.restAt !== null && now >= entry.restAt && !more) entry.resting = true;
    }
    if (this.mode === 'live') {
      if (sweep(this.state, now)) this.dirty = true;
      for (const id of evict(this.state, now)) this.forget(id);
    }
    // Browsers time the "reported back" bubbles, lingering contractors and briefing meetings by the snapshot clock:
    // keep it ticking while one of those windows is open. (A replay ticks on its own while it plays.)
    if (this.mode !== 'replay') {
      const timed = (a: { agentId: string | null; startedAt: number; endedAt: number | null }) =>
        (a.endedAt !== null && now - a.endedAt <= CONTRACTOR_LINGER_MS + 1500) || (a.agentId !== null && now - a.startedAt <= MEETING_MS + 1500);
      if (Object.values(this.state.agents).some(timed)) this.dirty = true;
    }
    if (this.mode !== 'demo') this.loadStudio();
  }

  private forget(sessionId: string) {
    for (const [path, entry] of this.tails) if (entry.sessionId === sessionId) this.tails.delete(path);
    this.seen.delete(sessionId);
    this.dirty = true;
  }

  /** Transcripts being read right now. */
  get following(): string[] {
    return [...this.tails].filter(([, entry]) => !entry.resting).map(([path]) => path);
  }

  snapshot(): Snapshot {
    // A replay runs on the session's own clock, so timed bubbles behave as they did live.
    const now = this.mode === 'replay' && this.replay ? this.replay.position : this.now();
    const byRecent = <T extends { lastEventAt: number }>(a: T, b: T) => b.lastEventAt - a.lastEventAt;
    const aside = this.aside?.view() ?? emptyAsideView(now - CATCH_UP_WINDOW_MS);
    return {
      project: { name: this.name, root: this.root },
      mode: this.mode,
      studio: this.studio,
      studioSource: this.studioSource,
      studioErrors: this.studioErrors,
      sessions: Object.values(this.state.sessions).sort(byRecent),
      agents: Object.values(this.state.agents).sort((a, b) => a.startedAt - b.startedAt),
      tasks: Object.values(this.state.tasks).sort((a, b) => a.createdAt - b.createdAt),
      gateRuns: this.state.gateRuns,
      activity: milestones(this.state.activity).slice(-ACTIVITY_IN_SNAPSHOT),
      totals: withOfficeSpend(totals(this.state), aside.spend),
      archived: { sessions: this.state.archive.sessions, people: Object.values(this.state.archive.people) },
      burn: burnRate(this.state, now),
      hooks: { lastEventAt: this.lastHookAt, ignored: this.ignoredHooks },
      replay: this.replay,
      aside,
      serverTime: now,
      pricesAsOf: PRICES_AS_OF,
    };
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Sends a snapshot to everyone watching if anything changed since the last one. */
  flush() {
    if (!this.dirty || this.listeners.size === 0) return;
    this.dirty = false;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  markDirty() {
    this.dirty = true;
  }

  /** True once after anything changed: for the hub, which composes and throttles its own snapshots instead of flush(). */
  takeChanges(): boolean {
    const changed = this.dirty;
    this.dirty = false;
    return changed;
  }
}
