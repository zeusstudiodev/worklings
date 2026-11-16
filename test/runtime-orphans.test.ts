// What a desk started in the background outlives its shell on Windows; closing the person's desk (or the company) still
// stops it, by the pids and creation times the office wrote down while the parent links existed, and nothing else.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { absorb, living, parseTable, startedBy, type Members, type ProcessTable } from '../src/runtime/descendants.ts';
import { alive, isDelivered, isDesk, isTurn, until, world } from './runtime-kit.ts';

const table = (rows: [pid: number, ppid: number, created: number][]): ProcessTable => new Map(rows.map(([pid, ppid, created]) => [pid, { ppid, created }]));

describe('the recorded family of a desk', () => {
  it('follows children and grandchildren from the desk', () => {
    const members: Members = new Map([[10, 100]]);
    absorb(members, table([[10, 1, 100], [11, 10, 110], [12, 11, 120], [99, 1, 50]]));
    expect([...members.keys()].sort()).toEqual([10, 11, 12]);
  });

  it("keeps a dead shell as a link, so a server that appears after its shell has gone is still the desk's", () => {
    const members: Members = new Map([[10, 100], [11, 110]]);
    // 11 (the shell) is no longer in the table; 12 names it as its parent.
    absorb(members, table([[10, 1, 100], [12, 11, 120]]));
    expect(members.has(12)).toBe(true);
  });

  it('does not follow a process whose parent pid was reused by a different process', () => {
    const members: Members = new Map([[10, 100], [11, 110]]);
    // pid 11 now belongs to a process created at 500, and its child isn't the desk's.
    absorb(members, table([[10, 1, 100], [11, 1, 500], [13, 11, 510]]));
    expect(members.has(13)).toBe(false);
    expect(living(members, table([[10, 1, 100], [11, 1, 500]]))).toEqual([10]);
  });

  it('does not take a process created before the parent it names', () => {
    const members: Members = new Map([[10, 100]]);
    absorb(members, table([[10, 1, 100], [14, 10, 90]]));
    expect(members.has(14)).toBe(false);
  });

  it('counts a member as running only when its creation time matches', () => {
    const members: Members = new Map([[10, 100], [11, 110]]);
    expect(living(members, table([[10, 1, 100], [11, 1, 111]]))).toEqual([10]);
  });

  it('reads Windows and ps lines, and skips anything else', () => {
    expect(parseTable('10 1 1760000000000\r\nnot a line\r\n11 10 1760000000500\r\n', 'win32')).toEqual(table([[10, 1, 1760000000000], [11, 10, 1760000000500]]));
    const ps = parseTable('  10     1 Fri Nov 13 10:00:00 2026\n  11    10 Fri Nov 13 10:00:05 2026\nbroken\n', 'linux');
    expect([...ps.keys()]).toEqual([10, 11]);
    expect(ps.get(11)!.created - ps.get(10)!.created).toBe(5000);
  });
});

describe('closing what a desk started in the background', () => {
  const orphan = { orphan: true, lingerMs: 6_000 };
  const hold = { wait: 120_000 };
  const bystanders: number[] = [];

  beforeEach(() => {
    vi.stubEnv('WORKLINGS_PROCESS_POLL_MS', '150');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const pid of bystanders.splice(0)) {
      try {
        process.kill(pid); // a process this test started
      } catch {
        // already gone
      }
    }
  });

  /** A process that is none of the desk's: started here, beside it. */
  function bystander(): number {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true, detached: true });
    child.unref();
    const pid = child.pid ?? 0;
    bystanders.push(pid);
    return pid;
  }

  const orphanOf = (w: { log(): { event: string; childPid?: number }[] }) => w.log().find((e) => e.event === 'orphan')?.childPid ?? 0;

  async function startServer(w: Awaited<ReturnType<typeof world>>, person: string) {
    w.board.deliver(w.plan(person), { text: 'From Robin: run the dev server [fake:server]', messageId: `m-${person}` });
    await w.rec.waitFor(isDelivered(`m-${person}`));
    await until(() => orphanOf(w) > 0, 30_000, 'the dev server to start');
    const server = orphanOf(w);
    expect(alive(server)).toBe(true);
    return server;
  }

  it('close() stops a dev server whose shell has exited, and leaves a process beside it alone', async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { server: [orphan, hold] } });
    const other = bystander();
    try {
      const server = await startServer(w, 'ada');
      await w.board.close('ada');
      await until(() => !alive(server), 15_000, 'the dev server to stop');
      expect(alive(other)).toBe(true);
    } finally {
      await w.close();
    }
  }, 90_000);

  it("says what a desk started, by its scratch folder: its dev server, never the desk itself, a bystander or another desk's", async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { server: [orphan, hold] } });
    const other = bystander();
    const scratchOf = (person: string) => [...w.hub.tokens.values()].find((t) => t.person === person)?.scratch ?? '';
    try {
      const server = await startServer(w, 'ada');
      w.board.deliver(w.plan('bo'), { text: 'From Robin: wait [fake:idle]', messageId: 'm-bo' });
      await w.rec.waitFor(isDelivered('m-bo'));
      const desk = w.starts().find((e) => e.event === 'start')?.pid;
      const mine = await startedBy(scratchOf('ada'));
      expect(mine.has(server)).toBe(true);
      expect(mine.has(other)).toBe(false);
      expect(mine.has(process.pid)).toBe(false);
      if (typeof desk === 'number') expect(mine.has(desk)).toBe(false);
      // Bo's desk started no server of its own, and Ada's isn't Bo's.
      expect((await startedBy(scratchOf('bo'))).has(server)).toBe(false);
      expect(await startedBy(join(w.scratch, 'nobody'))).toEqual(new Set());
      // Once the desk is closed its server is stopped, and nothing is left to name.
      await w.board.close('ada');
      await until(() => !alive(server), 15_000, 'the dev server to stop');
      expect(await startedBy(scratchOf('ada'))).toEqual(new Set());
    } finally {
      await w.close();
    }
  }, 120_000);

  it('closeAll() stops the dev servers of every desk', async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { server: [orphan, hold] } });
    try {
      const first = await startServer(w, 'ada');
      w.board.deliver(w.plan('bo'), { text: 'From Robin: run the dev server too [fake:server]', messageId: 'm-bo' });
      await w.rec.waitFor(isDelivered('m-bo'));
      await until(() => w.log().filter((e) => e.event === 'orphan').length === 2, 30_000, 'the second dev server to start');
      const servers = w.log().filter((e) => e.event === 'orphan').map((e) => e.childPid ?? 0);
      expect(servers).toContain(first);
      await w.board.closeAll();
      await until(() => servers.every((pid) => !alive(pid)), 15_000, 'both dev servers to stop');
    } finally {
      await w.close();
    }
  }, 120_000);

  it("a person's Stop interrupts the turn and leaves their dev server running, until their desk is closed", async () => {
    const w = await world({ heartbeatMs: 200, scenarios: { server: [orphan, hold] } });
    try {
      const server = await startServer(w, 'ada');
      w.board.stop(w.plan('ada'), { text: 'From Robin, the stakeholder: stop', messageId: 'm-stop' });
      await w.rec.waitFor(isTurn('ada'));
      await w.rec.waitFor(isDelivered('m-stop'));
      expect(alive(server)).toBe(true);
      await w.board.close('ada');
      await until(() => !alive(server), 15_000, 'the dev server to stop with the desk');
    } finally {
      await w.close();
    }
  }, 90_000);

  it('stops a dev server that an idle desk left behind when it exited on its own', async () => {
    const w = await world({ scenarios: { server: [orphan, { say: 'Server is up.' }] } }, { idleMs: 300 });
    try {
      const server = await startServer(w, 'ada');
      // The turn ends, the idle desk closes and its process exits; the server keeps running.
      await w.rec.waitFor(isTurn('ada'));
      await w.rec.waitFor(isDesk('ada', 'closed'), { ms: 30_000, what: 'the idle desk to close' });
      expect(alive(server)).toBe(true);
      await w.board.close('ada');
      await until(() => !alive(server), 15_000, 'the dev server to stop');
    } finally {
      await w.close();
    }
  }, 90_000);
});
