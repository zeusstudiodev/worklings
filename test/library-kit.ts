// Builds small throwaway libraries and projects in temp folders for composer and detection tests.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';

const realLibrary = fileURLToPath(new URL('../library/', import.meta.url));

/** A new folder under the run's temp root (see global-setup.ts), deleted with it when the run ends. */
export function tempDir(prefix = 'worklings-'): string {
  return mkdtempSync(join(inject('tempRoot'), prefix));
}

/** Writes files (path -> content) under root; objects are written as JSON. */
export function writeTree(root: string, files: Record<string, string | object>): string {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (path.endsWith('/')) mkdirSync(target, { recursive: true });
    else writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

/** A library made of the hand-written example files plus a domain that only references them. */
export function miniLibrary(): string {
  const root = tempDir('worklings-lib-');
  for (const path of ['roles/mobile-engineer.md', 'roles/qa-engineer.md', 'rules/typescript.md', 'rules/react-native-expo.md', 'skills/plan-feature', 'skills/code-gate']) {
    cpSync(join(realLibrary, path), join(root, path), { recursive: true });
  }
  writeTree(root, {
    'domains/mini-app.yaml': [
      'id: mini-app',
      'title: Mini app',
      'summary: A test domain built from the example files.',
      'detect:',
      '  dependencies: [expo]',
      '  files: [app.json]',
      'roles:',
      '  lean: [mobile-engineer, qa-engineer]',
      'rules: [typescript, react-native-expo]',
      'skills: [plan-feature]',
      'gates:',
      '  lean: [code-gate]',
      '',
    ].join('\n'),
  });
  return root;
}
