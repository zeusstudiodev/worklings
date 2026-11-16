// A made-up private blocklist for the privacy scan's tests (scripts/check-public.mjs reads the real one from outside the
// repository). Importing this first points WORKLINGS_PUBLIC_BLOCKLIST at it, for this process and its children.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TERMS = {
  localPath: String.raw`C:\Users\zelda\Desktop`,
  first: 'Quillon',
  surname: 'Fernwald',
  handle: 'quillonx',
  email: 'quill@quillmail.example',
  employer: 'Megacorpia',
  project: 'nebulapress',
} as const;

export const BLOCKLIST = join(mkdtempSync(join(tmpdir(), 'worklings-blocklist-')), 'public-blocklist.json');
writeFileSync(
  BLOCKLIST,
  JSON.stringify({
    patterns: [
      { label: 'local path', regex: String.raw`C:[\/]+Users[\/]+zelda\b|[/]Users[/]zelda\b` },
      { label: 'surname or handle', regex: 'Fernwald|quillonx', flags: 'i', identity: true },
      { label: 'first name', regex: 'quillon(?!x)', flags: 'i', identity: true },
      { label: 'personal email', regex: '@quillmail', flags: 'i', identity: true, inNotices: false },
      { label: 'employer', regex: String.raw`\bmegacorpia\b`, flags: 'i' },
      { label: 'private project', regex: 'nebulapress', flags: 'i' },
    ],
  }),
);
process.env.WORKLINGS_PUBLIC_BLOCKLIST = BLOCKLIST;
