// The commands the hub and the lobby give people to paste quote the folder as one word. PowerShell, where a Windows
// folder is pasted, takes ' and the typographic ‘ ’ ‚ ‛ all as single quotes, so each is doubled: a folder named
// x’; Write-Output INJECTED; ’y must stay a name, not end the word and run what follows.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { shellQuote } from '../src/hub/setup-routes.ts';
import { quoteFolder } from '../web/src/company/setup/setupModel.ts';

const QUOTES = ["'", '\u2018', '\u2019', '\u201A', '\u201B'];
const RSQ = '\u2019';
const INJECTION = `C:\\x${RSQ}; Write-Output INJECTED; ${RSQ}y`;

/** What PowerShell prints for `Write-Output <word>`, read as UTF-8; the command goes in base64, untouched by quoting. */
function powershellSays(word: string): string[] {
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\nWrite-Output ${word}`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  return out.split(/\r?\n/).filter((line) => line !== '');
}

describe('a folder quoted for PowerShell', () => {
  it.each(QUOTES)('doubles %s, which PowerShell takes as a single quote', (q) => {
    expect(shellQuote(`C:\\it${q}s here`, true)).toBe(`'C:\\it${q}${q}s here'`);
    expect(quoteFolder(`C:\\it${q}s here`)).toBe(`'C:\\it${q}${q}s here'`);
  });

  it('keeps a typographic quote in a bash word as it is', () => {
    expect(shellQuote(`/home/me/x${RSQ}y`, false)).toBe(`'/home/me/x${RSQ}y'`);
    expect(quoteFolder(`/home/me/x${RSQ}y`)).toBe(`'/home/me/x${RSQ}y'`);
  });

  it.runIf(process.platform === 'win32')('stays one word in PowerShell itself: nothing after a quote runs', () => {
    for (const quoted of [shellQuote(INJECTION, true), quoteFolder(INJECTION)]) {
      expect(powershellSays(quoted)).toEqual([INJECTION]);
    }
    const every = `C:\\a'b\u2018c\u2019d\u201Ae\u201Bf`;
    expect(powershellSays(shellQuote(every, true))).toEqual([every]);
  }, 120_000);
});
