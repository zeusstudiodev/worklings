import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./fixtures/claude-2.1.312/', import.meta.url));

/** The hook payloads captured from a real Claude Code 2.1.312 session, in the order they arrived. */
export function hookPayloads(): Record<string, unknown>[] {
  return readdirSync(`${root}hooks`)
    .sort()
    .map((f) => JSON.parse(readFileSync(`${root}hooks/${f}`, 'utf8')) as Record<string, unknown>);
}

export function transcript(name: 'main' | 'subagent'): string {
  const file = name === 'main' ? 'transcripts/main.jsonl' : 'transcripts/subagents/agent-acc52a8892c7c742e.jsonl';
  return readFileSync(`${root}${file}`, 'utf8');
}

export const SESSION = 'b0581371-e091-4b14-9a83-550be0bb1ac8';
export const SUBAGENT = 'acc52a8892c7c742e';
