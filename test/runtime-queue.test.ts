// The line for desks: the company's cap, the hub's gate shared by companies, resting on a usage limit and on the
// stakeholder's pause, and a cap that grows.
import { describe, expect, it } from 'vitest';
import { HubGate } from '../src/hub/gate.ts';
import { forStarts, isDelivered, isDesk, isLimited, isTurn, START_MS, testGate, world } from './runtime-kit.ts';

/** Lets the gate's queued notifications run. */
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

const quick = { heartbeatMs: 100, scenarios: { work: [{ tool: 'Bash', input: { command: 'npm test' }, ms: 600, ask: false }, { say: 'Done.' }] } };

describe('the line for desks', () => {
  it("keeps people in line at the company's open cap, and the longest-idle desk makes way for the next", async () => {
    // One desk open at all: with no room for an idle desk beside the one at work, each makes way for the next.
    const w = await world(quick, { maxDesks: 1, maxOpen: 1 });
    try {
      for (const [person, id] of [['ada', 'm-ada'], ['bo', 'm-bo'], ['cy', 'm-cy']] as const) w.board.deliver(w.plan(person), { text: `From Robin: go [fake:work]`, messageId: id });
      expect(w.board.desks().map((d) => [d.person, d.state, d.queue])).toEqual([
        ['ada', 'starting', null],
        ['bo', 'waiting', 1],
        ['cy', 'waiting', 2],
      ]);
      // One desk at a time: each turn waits for the desk before it to make way and for a desk of its own to start.
      for (const person of ['ada', 'bo', 'cy']) await w.rec.waitFor(isTurn(person), { ms: START_MS, what: `${person}'s turn` });
      const opened = w.rec.heard.flatMap((e) => (e.kind === 'desk' && e.view.state === 'starting' ? [e.view.person] : []));
      expect(opened).toEqual(['ada', 'bo', 'cy']);
      // Never two at once, though nobody waited for an idle timeout (it is a minute here).
      const pids = w.starts().map((s) => s.pid);
      const exits = w.log().filter((e) => e.event === 'exit');
      expect(exits.map((e) => e.pid)).toEqual(pids.slice(0, 2));
      for (const [i, start] of w.starts().entries()) if (i > 0) expect(start.at).toBeGreaterThanOrEqual(exits[i - 1]?.at ?? Infinity);
      const queued = w.rec.heard.flatMap((e) => (e.kind === 'desk' && e.view.person === 'cy' && e.view.state === 'waiting' ? [e.view.queue] : []));
      expect(queued).toEqual([2, 1]);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it('hands out desks to messages first, then task work in priority order, lower first, then in the order people came', async () => {
    const w = await world(quick, { maxDesks: 1 });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:work]', messageId: 'm-ada' });
      w.board.deliver(w.plan('bo'), { text: 'From Robin: go [fake:work]', messageId: 'm-bo', priority: 5 });
      w.board.deliver(w.plan('cy'), { text: 'From Robin: go [fake:work]', messageId: 'm-cy', priority: 1 });
      w.board.deliver(w.plan('dee'), { text: 'From Robin: go [fake:work]', messageId: 'm-dee' });
      expect(w.board.desks().map((d) => [d.person, d.state, d.queue])).toEqual([
        ['ada', 'starting', null],
        ['bo', 'waiting', 3],
        ['cy', 'waiting', 2],
        ['dee', 'waiting', 1],
      ]);
      for (const person of ['ada', 'dee', 'cy', 'bo']) await w.rec.waitFor(isTurn(person), { ms: START_MS, what: `${person}'s turn` });
      const opened = w.rec.heard.flatMap((e) => (e.kind === 'desk' && e.view.state === 'starting' ? [e.view.person] : []));
      expect(opened).toEqual(['ada', 'dee', 'cy', 'bo']);
    } finally {
      await w.close();
    }
  }, forStarts(5));

  it("gives the stakeholder's message to the CEO a desk before task work that came after it", async () => {
    const w = await world(quick, { maxDesks: 1 });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:work]', messageId: 'm-ada', priority: 1 });
      // The stakeholder writes to the CEO, whose desk had closed; then the board hands Bo his next task.
      w.board.deliver(w.plan('ceo'), { text: 'From Robin: pause the design room [fake:work]', messageId: 'm-ceo' });
      w.board.deliver(w.plan('bo'), { text: 'From the office: new task t-9 [fake:work]', messageId: 'm-bo', priority: 7 });
      for (const person of ['ada', 'ceo', 'bo']) await w.rec.waitFor(isTurn(person), { ms: START_MS, what: `${person}'s turn` });
      const opened = w.rec.heard.flatMap((e) => (e.kind === 'desk' && e.view.state === 'starting' ? [e.view.person] : []));
      expect(opened).toEqual(['ada', 'ceo', 'bo']);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it("holds desks to the hub's gate across companies", async () => {
    const gate = testGate(1);
    const w = await world(quick, { gate, idleMs: 200 });
    const { board: globex, rec: globexHeard } = w.another('globex', { gate });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:work]', messageId: 'm-ada' });
      await w.rec.waitFor(isDelivered('m-ada'));
      globex.deliver(w.plan('zed'), { text: 'From Robin: go', messageId: 'm-zed' });
      expect(globex.desks()).toEqual([expect.objectContaining({ person: 'zed', state: 'waiting', queue: 1 })]);
      expect(gate.inUse()).toBe(1);
      // Zed opens once Ada's desk has closed and given its place back.
      await w.rec.waitFor(isDesk('ada', 'closed'), { ms: 30_000 });
      const exitAt = w.log().find((e) => e.event === 'exit')?.at ?? Infinity;
      await globexHeard.waitFor(isDesk('zed', 'starting'), { ms: 30_000 });
      await globexHeard.waitFor(isDelivered('m-zed'));
      const zedStart = w.starts()[1];
      expect(zedStart?.at).toBeGreaterThanOrEqual(exitAt);
    } finally {
      await w.close();
    }
    expect(gate.inUse()).toBe(0);
  }, forStarts(3));

  it("makes another company's idle desk make way at the hub's gate, without waiting for it to idle out", async () => {
    // One hub desk, and an idle timeout far longer than the test: only the gate's call can free Ada's desk in time.
    const gate = new HubGate(1);
    const w = await world(quick, { gate, idleMs: 60_000 });
    const { board: globex, rec: globexHeard } = w.another('globex', { gate });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:work]', messageId: 'm-ada' });
      await w.rec.waitFor(isTurn('ada'));
      await w.rec.waitFor(isDesk('ada', 'idle'));
      expect(gate.inUse).toBe(1);
      globex.deliver(w.plan('zed'), { text: 'From Robin: go', messageId: 'm-zed' });
      await w.rec.waitFor(isDesk('ada', 'closed'), { ms: 20_000, what: "Ada's idle desk to make way" });
      await globexHeard.waitFor(isDelivered('m-zed'), { ms: START_MS, what: "Zed's desk to start" });
      expect(w.starts()).toHaveLength(2);
    } finally {
      await w.close();
    }
    expect(gate.inUse).toBe(0);
  }, forStarts(3));

  it('rests the company once on a usage limit, and moves the line again at the reset', async () => {
    const w = await world(
      { scenarios: { limit: [{ limit: { status: 'rejected', resetsInMs: 1_500, rateLimitType: 'five_hour', utilization: 1 } }, { fail: 'usage-limit' }] } },
      { maxDesks: 2, companyPauses: true },
    );
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:limit]', messageId: 'm-ada' });
      const limited = await w.rec.waitFor(isLimited);
      expect(limited.reason).toBe('usage-limit');
      expect(limited.message).toBe("Claude Code reports the plan's five-hour limit is used up.");
      expect(limited.until).not.toBeNull();
      const until = limited.until ?? 0;
      expect(until - limited.at).toBeGreaterThan(0);
      expect(until - limited.at).toBeLessThanOrEqual(2_500);
      const turn = await w.rec.waitFor(isTurn('ada'));
      expect(turn.result.ok).toBe(false);
      expect(turn.result.problem).toMatch(/^Claude Code hit a usage limit, so the turn stopped; it resets at \d\d:\d\d\.$/);
      // Work handed out while resting waits, and goes at the reset.
      w.board.deliver(w.plan('bo'), { text: 'From Robin: go', messageId: 'm-bo' });
      expect(w.board.desks().find((d) => d.person === 'bo')).toMatchObject({ state: 'waiting', queue: 1 });
      // What is left of the rest, then a desk start.
      await w.rec.waitFor(isDelivered('m-bo'), { ms: Math.max(0, until - Date.now()) + START_MS, what: "Bo's turn after the reset" });
      const boStart = w.starts()[1];
      expect(boStart?.at).toBeGreaterThanOrEqual(until);
      // The limit came twice (the event and the result) and was told once.
      expect(w.rec.heard.filter(isLimited)).toHaveLength(1);
    } finally {
      await w.close();
    }
  }, forStarts(3));

  it('rests on an overload for a while, saying so', async () => {
    const w = await world({ scenarios: { busy: [{ fail: 'overloaded' }] } });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:busy]', messageId: 'm-ada' });
      const limited = await w.rec.waitFor(isLimited);
      expect(limited).toMatchObject({ reason: 'overloaded', message: 'Claude is overloaded right now.' });
      expect((limited.until ?? 0) - limited.at).toBeGreaterThan(4 * 60_000);
    } finally {
      await w.close();
    }
  });

  it("holds new work while the stakeholder's pause lasts, and lets it go on resume", async () => {
    const w = await world({});
    try {
      w.board.pause(null);
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go', messageId: 'm-ada' });
      expect(w.board.desks()).toEqual([expect.objectContaining({ person: 'ada', state: 'waiting', queue: 1 })]);
      expect(w.starts()).toHaveLength(0);
      w.board.resume();
      await w.rec.waitFor(isDelivered('m-ada'));
      expect(w.starts()).toHaveLength(1);
    } finally {
      await w.close();
    }
  });

  it('lets more people in when the cap grows', async () => {
    const w = await world({ heartbeatMs: 100, scenarios: { long: [{ tool: 'Bash', input: { command: 'npm run dev' }, ms: 60_000, ask: false }] } }, { maxDesks: 1 });
    try {
      w.board.deliver(w.plan('ada'), { text: 'From Robin: go [fake:long]', messageId: 'm-ada' });
      w.board.deliver(w.plan('bo'), { text: 'From Robin: go [fake:long]', messageId: 'm-bo' });
      await w.rec.waitFor(isDelivered('m-ada'));
      expect(w.board.desks().find((d) => d.person === 'bo')?.state).toBe('waiting');
      w.board.setMaxDesks(2);
      await w.rec.waitFor(isDelivered('m-bo'));
      expect(w.board.desks().map((d) => d.state)).toEqual(['working', 'working']);
    } finally {
      await w.close();
    }
  }, forStarts(3));
});

describe("the hub's gate", () => {
  it('gives back every generation of a closing company, and ignores a late exit of one closed before', () => {
    const gate = new HubGate(3);
    gate.take('acme#1');
    gate.take('acme#1');
    gate.release('acme');
    expect(gate.inUse).toBe(0);
    // Reopened as a new switchboard: the closed one's late exit gives back under its old key and frees nothing.
    expect(gate.take('acme#2')).toBe(true);
    gate.give('acme#1');
    expect(gate.inUse).toBe(1);
  });

  it('asks the longest-idle desk of any company to make way, once per person waiting', () => {
    const gate = new HubGate(2);
    gate.take('a#1');
    gate.take('b#1');
    const yielded: string[] = [];
    // Like a switchboard with one idle desk: once that desk makes way it is idle no more.
    const yielder = (name: string, since: number) => {
      let idle: number | null = since;
      return {
        idleSince: () => idle,
        yieldOne: () => {
          if (idle === null) return false;
          idle = null;
          yielded.push(name);
          return true;
        },
      };
    };
    gate.onWant(yielder('a', 2_000));
    gate.onWant(yielder('b', 1_000));
    gate.want('c#1', 1);
    expect(yielded).toEqual(['b']);
    // Still waiting, but one desk is already on its way back: nobody else is asked.
    gate.want('c#1', 1);
    expect(yielded).toEqual(['b']);
    // A second person waiting asks the next longest idle.
    gate.want('c#1', 2);
    expect(yielded).toEqual(['b', 'a']);
  });

  it('hands freed desks to the waiting companies in turn', async () => {
    const gate = new HubGate(1);
    gate.take('x#1');
    const order: string[] = [];
    for (const name of ['a', 'b']) {
      gate.onFree(() => {
        if (gate.take(`${name}#1`)) order.push(name);
      });
    }
    gate.give('x#1');
    for (let round = 0; round < 4; round++) {
      await settle();
      gate.give(`${order.at(-1) ?? 'x'}#1`);
    }
    await settle();
    expect(order).toEqual(['a', 'b', 'a', 'b', 'a']);
  });
});
