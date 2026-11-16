// Plays the real Claude Code 2.1.312 session captured in test/fixtures into the live project office (the live office) as a
// brand-new session, the way Claude Code would: transcripts on disk first, then the hook payloads over HTTP.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { hookPayloads, SESSION, SUBAGENT } from '../fixtures.ts';
import { agentKey, leadKey } from '../../src/core/office.ts';
import { LIVE, ports } from './addresses.ts';

export { LIVE };
const PORT = ports().live;
/** What `worklings hooks install` puts in its hook URLs, to tell its hooks from anyone else's. */
const MARKER = 'from=worklings';
/** What hooks installed while Worklings was called Headcount carry instead: the office must still take them. */
const LEGACY_MARKER = 'from=headcount';
const fixtures = new URL('../fixtures/claude-2.1.312/', import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, fixtures), 'utf8');

export interface PlayedSession {
  sessionId: string;
  /** The key of the lead and of the subagent in /api/state's agents. */
  leadKey: string;
  subagentKey: string;
  subagentId: string;
  /** Where the transcripts of this session were written. */
  transcript: string;
  /** Posts the hooks that were held back (everything from `stopBefore` on). Does nothing when all were posted. */
  finish: () => Promise<void>;
}

export interface PlayOptions {
  /** Hold back the hooks from the first one with this event name on, e.g. 'SubagentStop' to catch the reviewer at work. */
  stopBefore?: string;
  /** The role the subagent plays; the captured one was Claude Code's `reviewer`. Must be a role of the generated studio. */
  role?: string;
  /** Replaces the captured prompt, so a test can tell its session from the others. */
  prompt?: string;
  /** Posts the hooks the way hooks installed before the rename do, with `?from=headcount`. */
  legacyHooks?: boolean;
}

/** Claude Code names a project's transcript folder after its path with every non-alphanumeric character as "-". */
export const projectFolderName = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** A raw request: fetch won't let a test set Host, and the office only takes hooks that look like Claude Code's. */
function post(payload: unknown, marker: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = request(
      { host: '127.0.0.1', port: PORT, path: `/hooks?${marker}`, method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${PORT}`, 'content-length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

export async function playSession(options: PlayOptions = {}): Promise<PlayedSession> {
  const projectDir = process.env.E2E_PROJECT ?? '';
  const claudeHome = process.env.E2E_CLAUDE_HOME ?? '';
  if (!projectDir || !claudeHome) throw new Error('E2E_PROJECT and E2E_CLAUDE_HOME come from playwright.config.ts');
  const role = options.role ?? 'code-reviewer';
  const sessionId = randomUUID();

  const folder = join(claudeHome, 'projects', projectFolderName(projectDir));
  const main = join(folder, `${sessionId}.jsonl`);
  const subDir = join(folder, sessionId, 'subagents');
  mkdirSync(subDir, { recursive: true });
  // The captured transcripts name the session and the folder they ran in; JSON-escape the path for Windows.
  const cwdJson = JSON.stringify(projectDir).slice(1, -1);
  const retarget = (text: string) => text.replaceAll(SESSION, sessionId).replace(/\/project(?![A-Za-z0-9_-])/g, () => cwdJson);
  const prompted = (text: string) => (options.prompt ? text.replace(/Do these steps in order\.[^"]*?finished\./g, options.prompt) : text);
  writeFileSync(main, prompted(retarget(fixture('transcripts/main.jsonl'))));
  const subFile = `agent-${SUBAGENT}.jsonl`;
  writeFileSync(join(subDir, subFile), retarget(fixture(`transcripts/subagents/${subFile}`)));
  for (const f of readdirSync(new URL('transcripts/subagents/', fixtures)).filter((n) => n.endsWith('.meta.json'))) {
    writeFileSync(join(subDir, f), JSON.stringify({ ...JSON.parse(fixture(`transcripts/subagents/${f}`)), agentType: role }));
  }

  const rewrite = (payload: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...payload, session_id: sessionId, cwd: projectDir, transcript_path: main };
    if ('agent_transcript_path' in out) out.agent_transcript_path = join(subDir, subFile);
    if ('agent_type' in out) out.agent_type = role;
    if (Array.isArray(out.background_tasks)) out.background_tasks = out.background_tasks.map((t: Record<string, unknown>) => ({ ...t, agent_type: role }));
    // The lead's Agent call names the role too; the office matches it to the subagent that starts from it.
    const input = out.tool_input as Record<string, unknown> | undefined;
    if (input && typeof input.subagent_type === 'string') out.tool_input = { ...input, subagent_type: role };
    if (options.prompt && typeof out.prompt === 'string') out.prompt = options.prompt;
    return out;
  };
  const payloads = hookPayloads().map(rewrite);
  const cut = options.stopBefore ? payloads.findIndex((p) => p.hook_event_name === options.stopBefore) : -1;
  if (options.stopBefore && cut < 0) throw new Error(`The captured session has no ${options.stopBefore} hook`);
  const send = async (list: Record<string, unknown>[]) => {
    for (const p of list) {
      const status = await post(p, options.legacyHooks ? LEGACY_MARKER : MARKER);
      if (status !== 200) throw new Error(`The office answered ${status} to ${String(p.hook_event_name)}`);
    }
  };
  await send(cut < 0 ? payloads : payloads.slice(0, cut));
  let held = cut < 0 ? [] : payloads.slice(cut);
  return {
    sessionId,
    leadKey: leadKey(sessionId),
    subagentKey: agentKey(sessionId, SUBAGENT),
    subagentId: SUBAGENT,
    transcript: main,
    finish: async () => {
      const rest = held;
      held = [];
      await send(rest);
    },
  };
}
