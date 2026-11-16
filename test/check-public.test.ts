// The "nothing personal" scan (scripts/check-public.mjs) on files as the release tree holds them, plugin runtime included.
import { BLOCKLIST, TERMS } from './public-blocklist-kit.ts';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { blocklist, foreignHome, personalIdentity, scanFiles, shipsBy } from '../scripts/check-public.mjs';

const file = (path: string, text: string) => ({ path, read: () => Buffer.from(text) });
const scan = (...files: { path: string; read: () => Buffer }[]) => scanFiles(files);

describe('check-public', () => {
  it("lets the redactor's own patterns through where they are bundled, and still catches a real key there", () => {
    const bundle = 'r=[/\\bsk-ant-[\\w-]{10,}/g,/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\\w{20,})/g,/\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b/g]';
    expect(scan(file('plugin/runtime/web/assets/now-abc.js', bundle)).hits).toBe(0);
    expect(scan(file('plugin/runtime/cli.mjs', 'const key = "sk-ant-api03-abcdefghijklmnop";')).hits).toBe(1);
    expect(scan(file('plugin/runtime/cli.mjs', 'token ghp_abcdefghijklmnopqrstuvwxyz0123')).hits).toBe(1);
    expect(scan(file('plugin/runtime/cli.mjs', 'AKIAABCDEFGHIJKLMNOP')).hits).toBe(1);
  });

  it("keeps third-party authors' addresses in any copy of the notices, but not the maintainer's name", () => {
    const notice = `Copyright Someone Else <someone${TERMS.email.slice(TERMS.email.indexOf('@'))}>`;
    expect(scan(file('plugin/runtime/web/THIRD-PARTY-NOTICES.md', notice)).hits).toBe(0);
    expect(scan(file('THIRD-PARTY-NOTICES.md', notice)).hits).toBe(0);
    expect(scan(file('docs/notes.md', notice)).hits).toBe(1);
    expect(scan(file('plugin/runtime/THIRD-PARTY-NOTICES.md', `Copyright Robin ${TERMS.surname}`)).hits).toBe(1);
  });
});

// Built from parts so this file passes the scan it tests.
const OTHER = ['some', 'one'].join('');

describe('check-public: Zeus Studio publishes it', () => {
  it("flags the private terms of the blocklist file, and leaves other names alone", () => {
    expect(scan(file('SPEC.md', `Decided by ${TERMS.first}, 5 Nov 2026.`)).hits).toBe(1);
    expect(scan(file('docs/a.md', `see ${TERMS.handle}.github.io`)).hits).toBeGreaterThan(0);
    expect(scan(file('docs/b.md', `the ${TERMS.employer} contract`)).hits).toBe(1);
    expect(scan(file('docs/c.md', `like ${TERMS.project}`)).hits).toBe(1);
    expect(scan(file('src/d.ts', `const p = '${TERMS.localPath.split(String.fromCharCode(92)).join('/')}';`)).hits).toBe(1);
    expect(scan(file('test/a.test.ts', "stakeholder: 'Robin'")).hits).toBe(0);
  });

  it("flags links to Worklings under any owner but scripts/home.json's", () => {
    expect(foreignHome('https://github.com/zeusstudiodev/worklings/issues')).toBe(-1);
    expect(foreignHome('claude plugin marketplace add zeusstudiodev/worklings')).toBe(-1);
    expect(foreignHome('https://zeusstudiodev.github.io/worklings/')).toBe(-1);
    expect(foreignHome(`https://github.com/${OTHER}/worklings`)).toBeGreaterThanOrEqual(0);
    expect(foreignHome(`claude plugin marketplace add ${OTHER}/worklings`)).toBeGreaterThanOrEqual(0);
    expect(foreignHome(`gh repo view ${OTHER}/worklings`)).toBeGreaterThanOrEqual(0);
    expect(foreignHome(`https://${OTHER}.github.io/worklings/`)).toBeGreaterThanOrEqual(0);
    expect(foreignHome('the worklings package')).toBe(-1);
  });

  it("knows the maintainer's own commit identity from a studio or noreply one", () => {
    expect(personalIdentity('Zeus Studio <support@zeusstudio.dev>')).toBe(false);
    expect(personalIdentity('Night Run <7+night@users.noreply.github.com>')).toBe(false);
    expect(personalIdentity(`${TERMS.first} <x@example.com>`)).toBe(true);
    expect(personalIdentity(`Someone <1+${TERMS.handle}@users.noreply.github.com>`)).toBe(true);
    expect(personalIdentity(`Someone <${TERMS.email}>`)).toBe(true);
    expect(personalIdentity(`Someone <someone@${TERMS.employer}.example>`)).toBe(false);
  });

  it('scans by default only what the release manifest ships', () => {
    const ships = shipsBy({ include: ['src/**', 'docs/**', 'README.md'], exclude: ['docs/launch/faq.md', '.claude/runs/**'] });
    expect(ships('src/a/b.ts')).toBe(true);
    expect(ships('README.md')).toBe(true);
    expect(ships('docs/launch/faq.md')).toBe(false);
    expect(ships('.claude/runs/v3/progress.md')).toBe(false);
  });
});

describe('check-public: the private blocklist', () => {
  it('reads its terms from the file, not from the repository', () => {
    expect(blocklist().map((p) => p.label)).toContain('employer');
  });

  it('refuses to run without the file, and says nothing of what it holds', () => {
    let out = '';
    let code = 0;
    try {
      execFileSync(process.execPath, ['scripts/check-public.mjs'], { encoding: 'utf8', env: { ...process.env, WORKLINGS_PUBLIC_BLOCKLIST: `${BLOCKLIST}.missing` }, stdio: 'pipe' });
    } catch (error) {
      const e = error as { status: number; stderr: string; stdout: string };
      code = e.status;
      out = e.stderr + e.stdout;
    }
    expect(code).toBe(2);
    expect(out).toContain('refuses to run without it');
    for (const term of Object.values(TERMS)) expect(out.toLowerCase()).not.toContain(term.toLowerCase());
  });
});
