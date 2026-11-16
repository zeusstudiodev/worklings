// Desk slots: people working at once (the usage limit) are not desks kept open (memory). An idle desk costs no tokens, so
// it stays open, warm, up to a higher cap; only at that cap does the longest-idle desk close to make room. And a
// person's desk, reopened, has the same scratch folder and the same prompt, so Claude Code's prompt cache still matches.
import { describe, expect, it } from 'vitest';
import { HUB_OPEN_DESKS, HubGate, hubOpenCap, MAX_HUB_DESKS } from '../src/hub/gate.ts';
import { DEFAULT_MAX_OPEN } from '../src/runtime/index.ts';
import { forStarts, type FakeLogEntry, isDelivered, isDesk, isTurn, START_MS, until, world, type World } from './runtime-kit.ts';

const work = { tool: 'Bash', input: { command: 'npm test' }, ms: 300, ask: false } as const;
const quick = { heartbeatMs: 100, scenarios: { work: [work, { say: 'Done.' }], long: [{ ...work, ms: 4_000 }, { say: 'Done.' }] } };

const go = (w: World, person: string, id: string, scenario = 'work') => w.board.deliver(w.plan(person), { text: `From Robin: go [fake:${scenario}]`, messageId: id });
const exits = (w: World) => w.log().filter((e) => e.event === 'exit');

/**
 * The most people at work (starting, working or stopping) at any moment, from what the company was told. Views changed
 * together are told one after the other, so a hand-over from one person to the next is read once all of it is told.
 */
function mostAtWork(w: World): number {
  const state = new Map<string, string>();
  const desks = w.rec.heard.flatMap((e) => (e.kind === 'desk' ? [e] : []));
  let most = 0;
  for (const [i, e] of desks.entries()) {
    state.set(e.view.person, e.view.state);
    if ((desks[i + 1]?.at ?? Infinity) - e.at < 20) continue;
    most = Math.max(most, [...state.values()].filter((s) => ['starting', 'working', 'stopping'].includes(s)).length);
  }
  return most;
}

/** The most desk processes alive at once, from the fake's own log. */
function mostOpen(log: FakeLogEntry[]): number {
  let alive = 0;
  let most = 0;
  for (const e of log) {
    if (e.event === 'start') alive++;
    else if (e.event === 'exit') alive--;
    most = Math.max(most, alive);
  }
  return most;
}

describe('slots for people at work and for desks kept open', () => {
  it('keeps idle desks open beside the one at work, and never has more at work than the cap', async () => {
    const w = await world(quick, { maxDesks: 1 });
    try {
      for (const [person, id] of [['ada', 'm-ada'], ['bo', 'm-bo'], ['cy', 'm-cy']] as const) go(w, person, id);
      for (const person of ['ada', 'bo', 'cy']) await w.rec.waitFor(isTurn(person), { ms: START_MS, what: `${person}'s turn` });
      await w.rec.waitFor(isDesk('cy', 'idle'));
      expect(mostAtWork(w)).toBe(1);
      // Nobody closed to make room: three processes, each idle and warm for its person's next turn.
      expect(exits(w)).toEqual([]);
      expect(w.starts()).toHaveLength(3);
      expect(w.board.desks().map((d) => [d.person, d.state])).toEqual([['ada', 'idle'], ['bo', 'idle'], ['cy', 'idle']]);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it('lets an idle desk take its next turn on the same process, and holds the turn in line while nobody can work', async () => {
    const w = await world(quick, { maxDesks: 1 });
    try {
      go(w, 'ada', 'm-1');
      await w.rec.waitFor(isDesk('ada', 'idle'), { ms: START_MS });
      go(w, 'bo', 'm-bo', 'long');
      await w.rec.waitFor(isDesk('bo', 'working'), { ms: START_MS });
      // Bo has the one working slot. Ada's desk is open and idle, and stays so: her turn waits for the slot, not for a restart.
      go(w, 'ada', 'm-2');
      expect(w.board.desks().find((d) => d.person === 'ada')).toMatchObject({ state: 'waiting', queue: 1 });
      expect(exits(w)).toEqual([]);
      await w.rec.waitFor(isDelivered('m-2'), { ms: START_MS, what: "Ada's second turn" });
      expect(w.starts()).toHaveLength(2);
      expect(exits(w)).toEqual([]);
      expect(mostAtWork(w)).toBe(1);
    } finally {
      await w.close();
    }
  }, forStarts(3));

  it('hands the one working slot out in line order among open desks and new ones', async () => {
    const w = await world(quick, { maxDesks: 1 });
    try {
      go(w, 'ada', 'm-1');
      await w.rec.waitFor(isDesk('ada', 'idle'), { ms: START_MS });
      go(w, 'bo', 'm-bo', 'long');
      await w.rec.waitFor(isDesk('bo', 'working'), { ms: START_MS });
      // Both wait for the slot: Cy needs a process too, Ada has hers. Cy came first, with a message, so Cy goes first.
      go(w, 'cy', 'm-cy');
      go(w, 'ada', 'm-2');
      expect(w.board.desks().map((d) => [d.person, d.state, d.queue])).toEqual([['ada', 'waiting', 2], ['bo', 'working', null], ['cy', 'waiting', 1]]);
      await w.rec.waitFor(isDelivered('m-2'), { ms: START_MS });
      const delivered = w.rec.heard.flatMap((e) => (e.kind === 'delivered' ? [e.messageId] : []));
      expect(delivered.indexOf('m-cy')).toBeLessThan(delivered.indexOf('m-2'));
      expect(mostAtWork(w)).toBe(1);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it('closes the longest-idle desk when the open cap is reached, and only then', async () => {
    const w = await world(quick, { maxDesks: 1, maxOpen: 2 });
    try {
      go(w, 'ada', 'm-ada');
      await w.rec.waitFor(isDesk('ada', 'idle'), { ms: START_MS });
      go(w, 'bo', 'm-bo');
      await w.rec.waitFor(isDesk('bo', 'idle'), { ms: START_MS });
      expect(exits(w)).toEqual([]);
      // A third person: both desks are open and idle, so the one idle longest (Ada) makes way, and Bo's stays.
      go(w, 'cy', 'm-cy');
      await w.rec.waitFor(isDesk('ada', 'closed'), { ms: 20_000, what: "Ada's desk to make way" });
      await w.rec.waitFor(isDelivered('m-cy'), { ms: START_MS, what: "Cy's turn" });
      const [adaStart] = w.starts();
      expect(exits(w).map((e) => e.pid)).toEqual([adaStart?.pid]);
      expect(w.board.desks().map((d) => [d.person, d.state])).toEqual([['ada', 'closed'], ['bo', 'idle'], ['cy', expect.stringMatching(/idle|working/)]]);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it('never holds more desks open than the cap, however many people there are', async () => {
    const w = await world(quick, { maxDesks: 2, maxOpen: 3 });
    try {
      const people = ['ada', 'bo', 'cy', 'dee', 'eli', 'fay', 'gus'];
      for (const person of people) go(w, person, `m-${person}`);
      for (const person of people) await w.rec.waitFor(isTurn(person), { ms: 3 * START_MS, what: `${person}'s turn` });
      await until(() => w.board.desks().every((d) => d.state !== 'working' && d.state !== 'waiting' && d.state !== 'starting'), START_MS, 'everyone to be done');
      expect(mostAtWork(w)).toBeLessThanOrEqual(2);
      expect(mostOpen(w.log())).toBeLessThanOrEqual(3);
      expect(w.board.desks().filter((d) => d.state === 'idle').length).toBeLessThanOrEqual(3);
    } finally {
      await w.close();
    }
  }, forStarts(10));

  it('never keeps fewer desks open than people allowed to work, whatever the open cap says', async () => {
    const w = await world({ heartbeatMs: 100, scenarios: { long: [{ ...work, ms: 4_000 }, { say: 'Done.' }] } }, { maxDesks: 3, maxOpen: 1 });
    try {
      for (const person of ['ada', 'bo', 'cy', 'dee']) go(w, person, `m-${person}`, 'long');
      // The three processes start side by side and come up in any order, so the snapshot waits for each of them
      // to be at work, not just the one that happened to be first.
      for (const person of ['ada', 'bo', 'cy']) await w.rec.waitFor(isDesk(person, 'working'), { ms: START_MS, what: `${person} at work` });
      expect(w.board.desks().map((d) => d.state)).toEqual(['working', 'working', 'working', 'waiting']);
      expect(mostAtWork(w)).toBe(3);
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it('takes the turn of an idle desk after a rest on the same process', async () => {
    const w = await world(quick, { maxDesks: 1 });
    try {
      go(w, 'ada', 'm-1');
      await w.rec.waitFor(isDesk('ada', 'idle'), { ms: START_MS });
      w.board.pause(null);
      go(w, 'ada', 'm-2');
      expect(w.board.desks()).toEqual([expect.objectContaining({ person: 'ada', state: 'waiting' })]);
      expect(exits(w)).toEqual([]);
      w.board.resume();
      await w.rec.waitFor(isDelivered('m-2'), { ms: START_MS });
      expect(w.starts()).toHaveLength(1);
    } finally {
      await w.close();
    }
  }, forStarts(2));
});

describe("a reopened person's desk", () => {
  it('has the same scratch folder and the same prompt every time, so the session still matches its prompt cache', async () => {
    // One desk open at all, so each person's desk makes way for the next and Ada's is reopened on her session.
    const w = await world(quick, { maxDesks: 1, maxOpen: 1 });
    try {
      go(w, 'ada', 'm-1');
      await w.rec.waitFor(isDelivered('m-1'), { ms: START_MS });
      go(w, 'bo', 'm-2');
      await w.rec.waitFor(isDelivered('m-2'), { ms: START_MS });
      go(w, 'ada', 'm-3');
      await w.rec.waitFor(isDelivered('m-3'), { ms: START_MS });
      const [first, other, again] = w.starts();
      expect(w.starts()).toHaveLength(3);
      const prompt = (e: FakeLogEntry | undefined) => e?.argv?.[(e.argv.indexOf('--append-system-prompt') ?? -2) + 1] ?? '';
      const folder = (e: FakeLogEntry | undefined) => e?.tmp?.TMPDIR ?? '';
      expect(folder(first)).not.toBe('');
      expect(folder(again)).toBe(folder(first));
      expect(prompt(again)).toBe(prompt(first));
      expect(prompt(first)).toContain(folder(first));
      // Another person's desk gets a folder of its own.
      expect(folder(other)).not.toBe(folder(first));
      // The reopened desk is a resume, not a new session.
      expect(again?.argv).toContain('--resume');
    } finally {
      await w.close();
    }
  }, forStarts(4));

  it("doesn't share a folder with a live desk of the same name run by another switchboard", async () => {
    const w = await world({ heartbeatMs: 100, scenarios: { long: [{ ...work, ms: 3_000 }, { say: 'Done.' }] } }, { maxDesks: 2 });
    // The same company id and project: Ada's stable folder is the same name on both, and the first one is alive.
    const { board: twin, rec: twinHeard } = w.another('acme', { maxDesks: 2 });
    try {
      go(w, 'ada', 'm-1', 'long');
      await w.rec.waitFor(isDesk('ada', 'working'), { ms: START_MS });
      twin.deliver(w.plan('ada'), { text: 'From Robin: go [fake:long]', messageId: 'm-twin' });
      await twinHeard.waitFor(isDesk('ada', 'working'), { ms: START_MS });
      const folders = w.starts().map((e) => e.tmp?.TMPDIR);
      expect(folders).toHaveLength(2);
      expect(folders[0]).not.toBe(folders[1]);
    } finally {
      await w.close();
    }
  }, forStarts(3));
});

describe("the hub's two caps", () => {
  it("doesn't close another company's idle desk for a person to work: only a process cap does", async () => {
    // Room for four desks open, one person at work.
    const gate = new HubGate(1, { open: () => 4 });
    const w = await world(quick, { gate, maxDesks: 4 });
    const { board: globex, rec: globexHeard } = w.another('globex', { gate, maxDesks: 4 });
    try {
      go(w, 'ada', 'm-ada', 'long');
      await w.rec.waitFor(isDesk('ada', 'working'), { ms: START_MS });
      globex.deliver(w.plan('zed'), { text: 'From Robin: go [fake:work]', messageId: 'm-zed' });
      // Zed has a free process but no working slot: nothing closes, and Zed isn't started yet.
      expect(globex.desks()).toEqual([expect.objectContaining({ person: 'zed', state: 'waiting', queue: 1 })]);
      expect(gate.working).toBe(1);
      expect(w.starts()).toHaveLength(1);
      await globexHeard.waitFor(isDelivered('m-zed'), { ms: 2 * START_MS, what: "Zed's turn once Ada is idle" });
      await w.rec.waitFor(isDesk('ada', 'idle'));
      expect(exits(w)).toEqual([]);
      expect(gate.inUse).toBe(2);
      await globexHeard.waitFor(isDesk('zed', 'idle'), { ms: START_MS });
      expect(gate.working).toBe(0);
    } finally {
      await w.close();
    }
    expect(gate.inUse).toBe(0);
    expect(gate.working).toBe(0);
  }, forStarts(4));

  it('counts open desks and people at work apart', async () => {
    const gate = new HubGate(2, { open: () => 5 });
    expect([gate.max, gate.openMax]).toEqual([2, 5]);
    expect([gate.take('a#1', true), gate.take('a#1', true), gate.take('b#1', true)]).toEqual([true, true, false]);
    expect([gate.inUse, gate.working]).toEqual([2, 2]);
    // Idle desks still fit in the open cap while everyone works.
    expect([gate.take('b#1'), gate.take('b#1'), gate.take('b#1')]).toEqual([true, true, true]);
    expect(gate.take('b#1')).toBe(false);
    expect([gate.inUse, gate.working]).toEqual([5, 2]);
    // An idle desk gives its working slot back and keeps its process; its person can take one for the next turn.
    gate.giveWork('a#1');
    expect(gate.hasWork()).toBe(true);
    expect(gate.takeWork('b#1')).toBe(true);
    expect(gate.takeWork('b#1')).toBe(false);
    expect([gate.inUse, gate.working]).toEqual([5, 2]);
    // A slot given back twice, or by a key that holds none, frees nothing.
    gate.giveWork('c#1');
    gate.giveWork('b#1');
    gate.giveWork('b#1');
    gate.giveWork('b#1');
    expect(gate.working).toBe(1);
    gate.release('a');
    expect([gate.inUse, gate.working]).toEqual([3, 0]);
    // The open cap follows the working cap: never below it.
    gate.setMax(8);
    expect([gate.max, gate.openMax]).toEqual([8, 8]);
  });

  it('keeps the old single cap when no open cap is given', () => {
    const gate = new HubGate(2);
    expect(gate.openMax).toBe(2);
    expect([gate.take('a'), gate.take('a'), gate.take('a')]).toEqual([true, true, false]);
  });

  it("sets the hub's open cap from its working cap", () => {
    expect([hubOpenCap(1), hubOpenCap(8), hubOpenCap(HUB_OPEN_DESKS), hubOpenCap(30), hubOpenCap(MAX_HUB_DESKS)]).toEqual([16, 16, 16, 30, 50]);
    expect(DEFAULT_MAX_OPEN).toBeGreaterThan(8);
  });
});
