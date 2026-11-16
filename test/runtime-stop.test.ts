// Stopping a turn, taking a message back, and desks that misbehave: a crash, a hang, garbage on stdout, a line cut off.
import { describe, expect, it } from 'vitest';
import { alive, forStarts, isDelivered, isDesk, isTurn, until, world } from './runtime-kit.ts';

const LONG = 60_000;
const longTool = { tool: 'Bash', input: { command: 'npm run build' }, ms: LONG, spawn: true };
/** The same long call with no child process of its own, for tests about the desk rather than what it started. */
const longQuiet = { tool: 'Bash', input: { command: 'npm run build' }, ms: LONG };

describe('stop', () => {
  it('interrupts the turn and gives the instruction as the next line, in the same process', async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { long: [longTool, { say: 'Built.' }] } });
    try {
      const plan = w.plan('ada');
      w.board.deliver(plan, { text: 'From Robin: build it [fake:long]', messageId: 'm-1' });
      await w.rec.waitFor(isDelivered('m-1'));
      await until(() => w.log().some((e) => e.event === 'child'), 20_000, 'the build to start');
      const child = w.log().find((e) => e.event === 'child')?.childPid ?? 0;
      w.board.stop(plan, { text: 'From Robin, the stakeholder: stop and write the summary instead', messageId: 'm-2' });
      await w.rec.waitFor(isDesk('ada', 'stopping'));
      const stopped = await w.rec.waitFor(isTurn('ada'));
      expect(stopped.result).toMatchObject({ ok: false, problem: 'Stopped before the turn finished.' });
      await w.rec.waitFor(isDelivered('m-2'));
      const next = await w.rec.waitFor((e): e is Extract<typeof e, { kind: 'turn' }> => isTurn('ada')(e) && e !== stopped);
      expect(next.result).toMatchObject({ ok: true, text: 'Fake desk: From Robin, the stakeholder: stop and write the summary instead' });
      expect(w.starts()).toHaveLength(1);
      expect(w.log().filter((e) => e.event === 'interrupt')).toHaveLength(1);
      // The interrupted command was stopped with its turn; a stop never shows as a failure.
      await until(() => !alive(child), 10_000, 'the interrupted command to stop');
      const idle = await w.rec.waitFor(isDesk('ada', 'idle'));
      expect(idle.view.problem).toBeNull();
    } finally {
      await w.close();
    }
  });

  it("kills a desk that doesn't answer the interrupt, and resumes its session with the instruction", async () => {
    const w = await world({ heartbeatMs: 200, interrupt: { ignore: true }, scenarios: { long: [longQuiet] } }, { timing: { interruptMs: 800 } });
    try {
      const plan = w.plan('ada');
      w.board.deliver(plan, { text: 'From Robin: build it [fake:long]', messageId: 'm-1' });
      await w.rec.waitFor(isDelivered('m-1'));
      w.board.stop(plan, { text: 'From Robin, the stakeholder: stop', messageId: 'm-2' });
      // A taskkill of the first desk, then a second desk's start.
      await w.rec.waitFor(isDelivered('m-2'), { ms: forStarts(2), what: 'the instruction in a resumed desk' });
      const turn = await w.rec.waitFor(isTurn('ada'));
      expect(turn.result.ok).toBe(true);
      const [first, second] = w.starts();
      expect(second?.argv?.[second.argv.indexOf('--resume') + 1]).toBe(first?.argv?.[first.argv.indexOf('--session-id') + 1]);
      expect(alive(first?.pid ?? 0)).toBe(false);
    } finally {
      await w.close();
    }
  }, forStarts(3));

  it('resumes the session of a desk killed before its init line, which Claude Code had already recorded', async () => {
    // The desk takes the message (started), then its MCP servers connect slowly: the stop's kill lands before init.
    const w = await world({ heartbeatMs: 200, initDelayMs: 5_000, interrupt: { ignore: true }, scenarios: { long: [longQuiet] } }, { timing: { interruptMs: 300 } });
    try {
      const plan = w.plan('ada');
      w.board.deliver(plan, { text: 'From Robin: build it [fake:long]', messageId: 'm-1' });
      await w.rec.waitFor(isDelivered('m-1'));
      w.board.stop(plan, { text: 'From Robin, the stakeholder: stop', messageId: 'm-2' });
      await w.rec.waitFor(isDelivered('m-2'), { ms: forStarts(2), what: 'the instruction in a resumed desk' });
      const [first, second] = w.starts();
      expect(second?.argv?.[second.argv.indexOf('--resume') + 1]).toBe(first?.argv?.[first.argv.indexOf('--session-id') + 1]);
      expect(second?.argv).not.toContain('--session-id');
    } finally {
      await w.close();
    }
  }, forStarts(3));

  it('gives an idle desk the instruction as a plain next turn, with no interrupt', async () => {
    const w = await world({});
    try {
      const plan = w.plan('ada');
      w.board.deliver(plan, { text: 'From Robin: hello', messageId: 'm-1' });
      await w.rec.waitFor(isDesk('ada', 'idle'));
      w.board.stop(plan, { text: 'From Robin: now this', messageId: 'm-2' });
      await w.rec.waitFor(isDelivered('m-2'));
      expect(w.log().some((e) => e.event === 'interrupt')).toBe(false);
    } finally {
      await w.close();
    }
  });
});

describe('withdraw', () => {
  it('takes back a turn still waiting in line, and not one already written to its desk', async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { long: [longTool] } }, { maxDesks: 1 });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: build [fake:long]', messageId: 'm-ada' });
      await w.rec.waitFor(isDelivered('m-ada'));
      w.board.deliver(w.plan('bo'), { text: 'From Robin: hello Bo', messageId: 'm-bo' });
      const waiting = await w.rec.waitFor(isDesk('bo', 'waiting'));
      expect(waiting.view.queue).toBe(1);
      expect(w.board.withdraw('m-bo')).toBe(true);
      await w.rec.waitFor(isDesk('bo', 'closed'));
      expect(w.board.withdraw('m-bo')).toBe(false);
      expect(w.board.withdraw('m-ada')).toBe(false);
      expect(w.starts()).toHaveLength(1);
    } finally {
      await w.close();
    }
  });
});

describe('a desk that misbehaves', () => {
  it('crashes: the desk fails with a sentence, and the next message resumes the session', async () => {
    const w = await world({ scenarios: { crash: [{ crash: { code: 3, stderr: 'Error: the fake desk crashed on purpose' } }] } });
    try {
      const plan = w.plan('ada');
      w.board.deliver(plan, { text: 'From Robin: go [fake:crash]', messageId: 'm-1' });
      const failed = await w.rec.waitFor(isDesk('ada', 'failed'));
      expect(failed.view.problem).toBe('Claude Code stopped unexpectedly (exit code 3): Error: the fake desk crashed on purpose');
      // It had started, so it reached them; nothing is sent again on its own.
      expect(w.rec.heard.some(isDelivered('m-1'))).toBe(true);
      expect(w.starts()).toHaveLength(1);
      w.board.deliver(plan, { text: 'From Robin: try again', messageId: 'm-2' });
      const turn = await w.rec.waitFor(isTurn('ada'));
      expect(turn.result.ok).toBe(true);
      expect(w.starts()[1]?.argv).toContain('--resume');
    } finally {
      await w.close();
    }
  });

  it('crashes before taking its message: one more desk tries it, then it waits for the next message', async () => {
    const w = await world({ startup: { exit: { code: 1, stderr: 'Error: bad install' } } });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go', messageId: 'm-1' });
      await until(() => w.starts().length === 2 && w.log().filter((e) => e.event === 'exit').length === 2, 20_000, 'two tries');
      const failed = await w.rec.waitFor((e): e is Extract<typeof e, { kind: 'desk' }> => isDesk('ada', 'failed')(e) && w.log().filter((x) => x.event === 'exit').length === 2);
      expect(failed.view.problem).toBe('Claude Code stopped unexpectedly (exit code 1): Error: bad install');
      expect(w.rec.heard.some(isDelivered('m-1'))).toBe(false);
      expect(w.starts()).toHaveLength(2);
    } finally {
      await w.close();
    }
  });

  it('hangs: the turn is interrupted after its silence, and the desk shows why', async () => {
    const w = await world({ scenarios: { hang: [{ hang: true }] } }, { timing: { hangMs: 700 } });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:hang]', messageId: 'm-1' });
      const turn = await w.rec.waitFor(isTurn('ada'));
      expect(turn.result).toMatchObject({ ok: false, problem: 'They stopped responding for 1 second, so the office stopped their turn.' });
      const failed = await w.rec.waitFor(isDesk('ada', 'failed'));
      expect(failed.view.problem).toBe('They stopped responding for 1 second, so the office stopped their turn.');
      expect(w.log().filter((e) => e.event === 'interrupt')).toHaveLength(1);
    } finally {
      await w.close();
    }
  });

  it("hangs and doesn't stop when asked: the desk is killed, with what it started", async () => {
    const w = await world(
      { heartbeatMs: 60_000, interrupt: { ignore: true }, scenarios: { deaf: [{ tool: 'Bash', input: { command: 'npm start' }, ms: LONG, spawn: true, ask: false }] } },
      { timing: { hangMs: 600, interruptMs: 500, approvalMs: 0 } },
    );
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:deaf]', messageId: 'm-1' });
      const failed = await w.rec.waitFor(isDesk('ada', 'failed'), { what: 'the desk to be closed as hung' });
      expect(failed.view.problem).toBe("They stopped responding for 1 second and didn't stop when asked, so the office closed their desk.");
      const pids = w.log().flatMap((e) => (e.event === 'start' ? [e.pid] : e.event === 'child' ? [e.childPid ?? 0] : []));
      expect(pids).toHaveLength(2);
      await until(() => pids.every((pid) => !alive(pid)), 10_000, 'the hung desk and its command to be gone');
    } finally {
      await w.close();
    }
  });

  it('writes garbage, a line too long to keep and a flood on standard error, and is still read', async () => {
    const w = await world({
      scenarios: { noisy: [{ garbage: ['not json', '{"type":', '42', '[]'] }, { big: 9 * 1024 * 1024 }, { stderr: 'x'.repeat(1_000), repeat: 2_000 }, { say: 'Still here.' }] },
    });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:noisy]', messageId: 'm-1' });
      const turn = await w.rec.waitFor(isTurn('ada'), { ms: 60_000 });
      expect(turn.result).toMatchObject({ ok: true, text: 'Still here.' });
    } finally {
      await w.close();
    }
  });

  it('dies in the middle of a line: the cut line is dropped and the desk fails', async () => {
    const w = await world({ scenarios: { cut: [{ partial: '{"type":"result","subtype":"succ' }] } });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:cut]', messageId: 'm-1' });
      const failed = await w.rec.waitFor(isDesk('ada', 'failed'));
      expect(failed.view.problem).toBe("Claude Code stopped unexpectedly (exit code 1) and didn't say why.");
      expect(w.rec.heard.some(isTurn('ada'))).toBe(false);
    } finally {
      await w.close();
    }
  });
});
