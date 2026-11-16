import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compose } from '../src/composer/compose.ts';
import { detect } from '../src/composer/detect.ts';
import { loadLibrary } from '../src/composer/library.ts';
import { NOTES_END, NOTES_START, tailorRole, TailorError } from '../src/composer/tailor.ts';
import { writePlan } from '../src/composer/write.ts';
import { project } from './projects.ts';

const library = loadLibrary();

function studio() {
  const root = project('expo');
  writePlan(root, compose({ library, domain: 'mobile-app', rigor: 'lean', detection: detect(root, library), version: '0.1.0' }));
  return root;
}

describe('tailorRole', () => {
  it('adds project notes at the end of the This project section and replaces them on the next run', () => {
    const root = studio();
    const path = join(root, '.claude/agents/mobile-engineer.md');
    const before = readFileSync(path, 'utf8');
    tailorRole(root, 'mobile-engineer', ['Streak days follow the device calendar, not UTC.', '- No Mac: test on a real iPhone through a dev build.']);
    const once = readFileSync(path, 'utf8');
    expect(once.startsWith(before.trimEnd())).toBe(true);
    expect(once).toContain(`${NOTES_START}\n- Streak days follow the device calendar, not UTC.\n- No Mac: test on a real iPhone through a dev build.\n${NOTES_END}\n`);
    tailorRole(root, 'mobile-engineer', ['Reminders reschedule when a plant is edited.']);
    const twice = readFileSync(path, 'utf8');
    expect(twice.split(NOTES_START)).toHaveLength(2);
    expect(twice).toContain('- Reminders reschedule when a plant is edited.');
    expect(twice).not.toContain('UTC');
  });

  it('replaces notes an earlier version wrote with one new block and changes nothing else', () => {
    const root = studio();
    const path = join(root, '.claude/agents/mobile-engineer.md');
    const role = readFileSync(path, 'utf8');
    writeFileSync(path, `${role}<!-- headcount:notes -->\n- Streak days follow the device calendar, not UTC.\n<!-- /headcount:notes -->\n`);
    tailorRole(root, 'mobile-engineer', ['Reminders reschedule when a plant is edited.']);
    expect(readFileSync(path, 'utf8')).toBe(`${role}<!-- worklings:notes -->\n- Reminders reschedule when a plant is edited.\n<!-- /worklings:notes -->\n`);
  });

  it('leaves one block in a role file that has notes under both markers', () => {
    const root = studio();
    const path = join(root, '.claude/agents/mobile-engineer.md');
    const role = readFileSync(path, 'utf8');
    const old = '<!-- headcount:notes -->\n- Old note.\n<!-- /headcount:notes -->\n';
    const current = `${NOTES_START}\n- Current note.\n${NOTES_END}\n`;
    const one = `${NOTES_START}\n- Newest note.\n${NOTES_END}\n`;
    for (const text of [`${role}${current}${old}`, `${role}${old}${current}`]) {
      writeFileSync(path, text);
      tailorRole(root, 'mobile-engineer', ['Newest note.']);
      expect(readFileSync(path, 'utf8')).toBe(`${role}${one}`);
    }
  });

  it('refuses missing roles, empty or oversized notes and bad ids', () => {
    const root = studio();
    expect(() => tailorRole(root, 'wizard', ['x'])).toThrow('No agent file for "wizard" in .claude/agents: hire the role first.');
    expect(() => tailorRole(root, '../etc', ['x'])).toThrow(TailorError);
    expect(() => tailorRole(root, 'qa-engineer', ['   '])).toThrow('Give at least one note');
    expect(() => tailorRole(root, 'qa-engineer', Array.from({ length: 9 }, (_, i) => `note ${i}`))).toThrow('Keep it to 8 notes');
    expect(() => tailorRole(root, 'qa-engineer', ['x'.repeat(301)])).toThrow('Keep each note under 300 characters');
  });
});
