// The second half of the web fixes from the design, accessibility and web code gates: the order queue the board sends
// through, the shell commands the setup quotes, the callout that says its fact once, what Settings offers for the demo
// company, storage that is blocked, and the key drafts are kept under.
import { describe, expect, it } from 'vitest';
import { OrderQueue, pendingSettled } from '../web/src/company/tasks/boardModel.ts';
import { claudeNotice, noticeSpeech, quoteFolder, removeCommand } from '../web/src/company/setup/setupModel.ts';
import { offersRemoval } from '../web/src/company/settings/settingsModel.ts';
import { draftScope } from '../web/src/company/ui/draftScope.ts';
import { readStill, safeStorage } from '../web/src/lib/stillCore.ts';

/** A send the test answers by hand. */
function desk() {
  const sent: string[][] = [];
  const answers: { ok: () => void; fail: (e: unknown) => void }[] = [];
  const send = (order: string[]) =>
    new Promise<void>((resolve, reject) => {
      sent.push(order);
      answers.push({ ok: resolve, fail: reject });
    });
  return { sent, answers, send };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the order queue the board sends through', () => {
  it('sends the first order at once and says it settled when it is answered', async () => {
    const d = desk();
    const log: string[] = [];
    const q = new OrderQueue(d.send, { started: () => log.push('started'), settled: () => log.push('settled'), refused: () => log.push('refused') });
    q.push(['b', 'a']);
    expect(d.sent).toEqual([['b', 'a']]);
    expect(q.sending).toBe(true);
    d.answers[0]?.ok();
    await tick();
    expect(log).toEqual(['started', 'settled']);
    expect(q.sending).toBe(false);
  });

  it('holds only the latest order made while one is on its way, and sends it after the answer', async () => {
    const d = desk();
    const log: string[] = [];
    const q = new OrderQueue(d.send, { started: () => log.push('started'), settled: () => log.push('settled'), refused: () => log.push('refused') });
    q.push(['b', 'a', 'c']);
    q.push(['a', 'b', 'c']);
    q.push(['c', 'a', 'b']);
    expect(d.sent).toHaveLength(1);
    d.answers[0]?.ok();
    await tick();
    expect(d.sent).toEqual([
      ['b', 'a', 'c'],
      ['c', 'a', 'b'],
    ]);
    expect(log).toEqual(['started', 'started']);
    d.answers[1]?.ok();
    await tick();
    expect(log).toEqual(['started', 'started', 'settled']);
  });

  it('drops what waited when the office refuses, and tells the caller so', async () => {
    const d = desk();
    const refused: unknown[] = [];
    const log: string[] = [];
    const q = new OrderQueue(d.send, { started: () => log.push('started'), settled: () => log.push('settled'), refused: (e) => refused.push(e) });
    q.push(['b', 'a']);
    q.push(['a', 'b']);
    d.answers[0]?.fail(new Error('No'));
    await tick();
    expect(refused).toHaveLength(1);
    expect(d.sent).toHaveLength(1);
    expect(log).toEqual(['started']);
    // Free again: the next order goes out.
    q.push(['a', 'b']);
    expect(d.sent).toHaveLength(2);
  });
});

describe("when your order gives way to the office's", () => {
  const pending = ['b', 'a', 'c'];
  it('stays while nothing was settled, whatever the stream shows', () => {
    expect(pendingSettled(['a', 'b', 'c'], pending, null)).toBe(false);
  });
  it('stays after the office took it while the stream still shows the order it had then', () => {
    expect(pendingSettled(['a', 'b', 'c'], pending, 'a\nb\nc')).toBe(false);
  });
  it('goes once the stream shows yours, or moves on from the order it had', () => {
    expect(pendingSettled(['b', 'a', 'c'], pending, 'a\nb\nc')).toBe(true);
    expect(pendingSettled(['c', 'a', 'b'], pending, 'a\nb\nc')).toBe(true);
  });
  it('has nothing to give way when there is no order of yours', () => {
    expect(pendingSettled(['a'], null, 'a')).toBe(false);
  });
});

describe('the command that takes the hooks out', () => {
  it('quotes a Windows folder in single quotes, a quote doubled for PowerShell', () => {
    expect(quoteFolder('C:\\Users\\you\\Projects\\plant pal')).toBe("'C:\\Users\\you\\Projects\\plant pal'");
    expect(quoteFolder("C:\\Users\\o'neil\\app")).toBe("'C:\\Users\\o''neil\\app'");
  });
  it('quotes a POSIX folder so $, backticks and a quote stay literal in bash', () => {
    expect(quoteFolder('/home/me/$(rm -rf x)')).toBe("'/home/me/$(rm -rf x)'");
    expect(quoteFolder("/home/o'neil/app")).toBe(String.raw`'/home/o'\''neil/app'`);
  });
  it('puts the quoted folder in the command', () => {
    expect(removeCommand('/srv/app')).toBe("npx worklings hooks uninstall '/srv/app'");
  });
});

describe('the Claude Code callout', () => {
  const claude = (state: 'signed-out' | 'missing', message: string) => ({ state, message, fix: 'Run claude once in a terminal and sign in.', link: null });
  it("says a signed-out Claude Code's fact once: the title has it, the text under it doesn't repeat it", () => {
    const notice = claudeNotice(claude('signed-out', "Claude Code 2.1.312 isn't signed in."));
    expect(notice?.title).toBe("Claude Code isn't signed in");
    expect(notice?.shown).toBeNull();
    expect(notice && noticeSpeech(notice)).toBe("Claude Code isn't signed in. Run claude once in a terminal and sign in.");
  });
  it('keeps the sentence for a missing one, whose title says something else', () => {
    const notice = claudeNotice(claude('missing', "Claude Code isn't installed."));
    expect(notice?.shown).toBe("Claude Code isn't installed.");
    expect(notice && noticeSpeech(notice)).toBe("Claude Code isn't ready. Claude Code isn't installed. Run claude once in a terminal and sign in.");
  });
});

describe('Settings and the demo company', () => {
  it('offers removal for a real company, and for the demo only in a tab that is itself the demo', () => {
    expect(offersRemoval(false, false)).toBe(true);
    expect(offersRemoval(true, true)).toBe(true);
    expect(offersRemoval(true, false)).toBe(false);
  });
});

describe('storage the browser blocks', () => {
  const blocked = (): never => {
    throw new DOMException('denied', 'SecurityError');
  };
  it('reads as an office that moves, and keeps nothing, when even the getter throws', () => {
    const storage = safeStorage(blocked);
    expect(readStill(storage)).toBe(false);
    expect(() => storage.setItem('k', 'v')).not.toThrow();
    expect(storage.getItem('k')).toBeNull();
  });
  it('hands over storage that works as it is', () => {
    const held = new Map<string, string>();
    const storage = safeStorage(() => ({
      getItem: (k) => held.get(k) ?? null,
      setItem: (k, v) => void held.set(k, v),
      removeItem: (k) => void held.delete(k),
    }));
    storage.setItem('worklings-still-office', 'on');
    expect(readStill(storage)).toBe(true);
  });
});

describe('drafts of a company whose id came back', () => {
  it("keeps one company's drafts apart from another that reuses its id", () => {
    const first = draftScope({ id: 'plant-pal', prompt: 'A cozy houseplant game' });
    expect(draftScope({ id: 'plant-pal', prompt: 'A cozy houseplant game' })).toBe(first);
    expect(draftScope({ id: 'plant-pal', prompt: 'A bookkeeping app for shops' })).not.toBe(first);
    expect(draftScope({ id: 'cafe', prompt: 'A cozy houseplant game' })).not.toBe(first);
  });
});
