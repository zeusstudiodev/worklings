// v0.4 (SPEC-v0.4.md, H2): the helpers a desk's person started with the Agent tool, as Claude Code 2.1.312 writes them
// beside the desk's transcript: `<session>/subagents/agent-<id>.meta.json` (its type, what it was asked, whether it
// finished) and `agent-<id>.jsonl` (its turns). The hub reads them on each poll so the office can draw each helper
// beside its person's desk while it works. Everything read here is untrusted: ids are checked, files are capped, and
// only the four fields below are kept.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface HelperFile {
  agentId: string;
  agentType: string;
  description: string;
  finished: boolean;
  transcript: string;
}

const META = /^agent-([A-Za-z0-9_-]{1,64})\.meta\.json$/;
const MAX_META_BYTES = 64 * 1024;
/** At most this many helpers a session, newest first: a desk that started hundreds keeps the office's poll cheap. */
const MOST = 24;

/** The helpers under one desk session's folder; none when it has no subagents folder. */
export function helpersOf(folder: string, sessionId: string): HelperFile[] {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) return [];
  const dir = join(folder, sessionId, 'subagents');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found: (HelperFile & { at: number })[] = [];
  for (const name of names) {
    const m = META.exec(name);
    if (!m?.[1]) continue;
    const file = join(dir, name);
    try {
      const st = statSync(file);
      if (!st.isFile() || st.size > MAX_META_BYTES) continue;
      const meta: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) continue;
      const o = meta as Record<string, unknown>;
      const agentType = typeof o.agentType === 'string' && /^[\w:.@ -]{1,100}$/.test(o.agentType) ? o.agentType : 'agent';
      const description = typeof o.description === 'string' ? o.description.slice(0, 500) : '';
      found.push({ agentId: m[1], agentType, description, finished: o.finished === true, transcript: join(dir, `agent-${m[1]}.jsonl`), at: st.mtimeMs });
    } catch {
      // A file being written, or not JSON: the next poll reads it again.
    }
  }
  return found
    .sort((a, b) => b.at - a.at)
    .slice(0, MOST)
    .map(({ at: _at, ...h }) => h);
}
