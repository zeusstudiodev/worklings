// Writes a composed studio into a project without clobbering anyone's work: existing files that differ are left
// alone unless --force, and then they are backed up first.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { plainPath } from '../safe-fs.ts';
import { type Plan, withClaudeBlock } from './compose.ts';

export interface WriteResult {
  written: string[];
  unchanged: string[];
  /** Existing files that differ from the plan and were left alone. */
  kept: string[];
  backups: string[];
}

export interface WriteOptions {
  force?: boolean;
  dryRun?: boolean;
  /** Used to name the backup folder; defaults to the current time. */
  now?: Date;
}

const normalise = (text: string) => text.replace(/\r\n/g, '\n');

export function writePlan(root: string, plan: Plan, options: WriteOptions = {}): WriteResult {
  const result: WriteResult = { written: [], unchanged: [], kept: [], backups: [] };
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backupRoot = join(root, '.claude', 'studio', 'backup', stamp);

  const put = (relative: string, content: string) => {
    const target = plainPath(root, relative);
    if (existsSync(target)) {
      const current = normalise(readFileSync(target, 'utf8'));
      if (current === normalise(content)) {
        result.unchanged.push(relative);
        return;
      }
      if (!options.force) {
        result.kept.push(relative);
        return;
      }
      if (!options.dryRun) {
        const backup = plainPath(root, join(backupRoot, relative));
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(target, backup);
      }
      result.backups.push(relative);
    }
    if (!options.dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    result.written.push(relative);
  };

  for (const file of plan.files) put(file.path, file.content);

  // CLAUDE.md is shared with the person's own notes: only the marked block is ever replaced, so no --force needed.
  const claudePath = plainPath(root, 'CLAUDE.md');
  // A project that keeps its instructions in AGENTS.md (shared with Codex and others) gets a CLAUDE.md that imports
  // it, so adding the studio never hides those instructions from Claude Code.
  const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : existsSync(join(root, 'AGENTS.md')) ? '@AGENTS.md\n' : null;
  const next = withClaudeBlock(existing, plan.claudeBlock);
  if (existing !== null && normalise(existing) === normalise(next)) result.unchanged.push('CLAUDE.md');
  else {
    if (!options.dryRun) writeFileSync(claudePath, next);
    result.written.push('CLAUDE.md');
  }
  return result;
}
