// Every folder the tests make goes under one root that is deleted when the run ends, so test runs don't pile up
// thousands of folders in the system temp directory.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    tempRoot: string;
  }
}

export default function setup(project: TestProject): () => void {
  const root = mkdtempSync(join(tmpdir(), 'worklings-test-'));
  project.provide('tempRoot', root);
  // Claude Code's own files are the user's, and a test never reads them: lean desks and the CEO's catalogue look in
  // CLAUDE_CONFIG_DIR, which here is an empty folder (a test that wants servers or settings writes its own).
  const config = join(root, 'claude-config');
  mkdirSync(config);
  process.env.CLAUDE_CONFIG_DIR = config;
  // Windows can hold a file for a moment after the process that used it ends; retry instead of failing the run.
  return () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
