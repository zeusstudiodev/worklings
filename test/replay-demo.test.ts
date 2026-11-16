import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { agentKey, leadKey } from '../src/core/office.ts';
import { payroll } from '../src/core/payroll.ts';
import { DEMO_SESSION, DemoPlayer, demoScript, demoStudio } from '../src/server/demo.ts';
import { Office } from '../src/server/office.ts';
import { listSessions, ReplayPlayer, sessionEvents, transcriptDir } from '../src/server/replay.ts';
import { SESSION, SUBAGENT } from './fixtures.ts';
import { tempDir } from './library-kit.ts';

const fixtures = fileURLToPath(new URL('./fixtures/claude-2.1.312/transcripts/', import.meta.url));

describe('replay', () => {
  const config = tempDir('worklings-claude-');
  const previous = process.env.CLAUDE_CONFIG_DIR;
  beforeAll(() => {
    // The captured session, laid out the way Claude Code stores it for a project at /project.
    process.env.CLAUDE_CONFIG_DIR = config;
    const dir = transcriptDir('/project');
    mkdirSync(join(dir, SESSION), { recursive: true });
    cpSync(join(fixtures, 'main.jsonl'), join(dir, `${SESSION}.jsonl`));
    cpSync(join(fixtures, 'subagents'), join(dir, SESSION, 'subagents'), { recursive: true });
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  });

  it('lists recorded sessions with their first prompt', () => {
    const sessions = listSessions('/project');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: SESSION, subagents: 1, title: expect.stringMatching(/^Do these steps in order/) });
    expect(sessions[0]?.endedAt).toBeGreaterThan(sessions[0]?.startedAt ?? Infinity);
  });

  it('rebuilds the session with its subagent arriving and leaving', () => {
    const events = sessionEvents('/project', SESSION);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('subagent-start');
    expect(kinds).toContain('subagent-stop');
    expect(kinds.at(-1)).toBe('turn-end');
    const times = events.map((e) => e.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(events.filter((e) => e.kind === 'usage')).toHaveLength(7);
  });

  it('plays the session into the office at speed and stops at the end', () => {
    const office = new Office('/project', 'Test', 'replay');
    const player = new ReplayPlayer(office, '/project');
    player.load(SESSION, 'Test session');
    player.setSpeed(600);
    player.play(true);
    let now = Date.now();
    for (let i = 0; i < 200 && player.playing; i++) player.tick((now += 1000));
    player.stop();
    expect(player.playing).toBe(false);
    expect(office.state.agents[leadKey(SESSION)]?.usage.output).toBe(1073);
    expect(office.state.agents[agentKey(SESSION, SUBAGENT)]).toMatchObject({ agentType: 'reviewer', status: 'done' });
    expect(office.replay).toMatchObject({ sessionId: SESSION, playing: false, speed: 600 });
    // The snapshot runs on the session's clock, so timed bubbles behave as they did live.
    expect(office.snapshot().serverTime).toBe(office.replay?.position);
    expect(() => player.setSpeed(0)).toThrow('Speed must be between 0 and 600.');
    // Play at the end starts the session over.
    player.play(true);
    expect(player.playing).toBe(true);
    expect(Object.keys(office.state.agents)).toEqual([]);
    player.stop();
  });
});

describe('demo', () => {
  const library = loadLibrary();

  it('scripts a consistent session: every tool finishes, every subagent starts before it works', () => {
    const script = demoScript();
    expect(script.map(([t]) => t)).toEqual([...script.map(([t]) => t)].sort((a, b) => a - b));
    const open = new Map<string, number>();
    const started = new Set<string>();
    for (const [t, step] of script) {
      if (step.kind === 'subagent-start') started.add(step.agentId);
      if ('agentId' in step && step.agentId && step.kind !== 'subagent-start') expect(started.has(step.agentId), `${step.kind} at ${t}`).toBe(true);
      if (step.kind === 'tool-start') open.set(step.toolUseId, t);
      if (step.kind === 'tool-end') open.delete(step.toolUseId);
    }
    expect([...open.keys()]).toEqual([]);
  });

  it('staffs every role the script uses', () => {
    const studio = demoStudio(library, '0.1.0');
    const roles = new Set(studio.roles.map((r) => r.id));
    for (const [, step] of demoScript()) if (step.kind === 'subagent-start' && step.agentType !== 'Explore') expect(roles.has(step.agentType), step.agentType).toBe(true);
    expect(studio.gates.map((g) => g.id).sort()).toEqual(['a11y-gate', 'code-gate', 'design-gate']);
  });

  it('plays out with gates closed, costs counted and the release manager idle', () => {
    const office = new Office(process.cwd(), 'Plant Pal', 'demo');
    office.setStudio({ studio: demoStudio(library, '0.1.0'), source: 'manifest', errors: [] });
    const player = new DemoPlayer(office);
    const start = Date.now();
    player.start(start);
    player.stop();
    player.tick(start + 119_000);
    const agents = Object.values(office.state.agents);
    expect(agents.filter((a) => a.sessionId === DEMO_SESSION)).toHaveLength(8);
    expect(office.state.gateRuns.map((g) => [g.gateId, g.until !== null])).toEqual([
      ['design-gate', true],
      ['a11y-gate', true],
      ['code-gate', true],
    ]);
    const p = payroll(agents, office.studio);
    expect(p.total.cost).toBeGreaterThan(0.5);
    expect(p.idle).toEqual(['release-manager']);
    player.tick(start + 151_000);
    expect(office.state.agents).toEqual({});
  });
});

describe('replay pacing', () => {
  it('skips long silences between events', () => {
    const config = tempDir('worklings-claude-gap-');
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      const dir = transcriptDir('/gap');
      mkdirSync(dir, { recursive: true });
      const line = (at: string, text: string) => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
      writeFileSync(join(dir, 'gap-session.jsonl'), `${line('2026-11-03T18:00:00Z', 'first prompt')}\n${line('2026-11-04T14:00:00Z', 'try again')}\n`);
      const office = new Office('/gap', 'Gap', 'replay');
      const player = new ReplayPlayer(office, '/gap');
      player.load('gap-session', 'Gap');
      player.setSpeed(1);
      player.play(true);
      const start = Date.now();
      player.tick(start + 100);
      player.tick(start + 3_200); // jumps to two seconds before the next prompt
      expect(office.state.activity.map((a) => a.text)).toEqual(['first prompt']);
      player.tick(start + 5_400);
      player.stop();
      // Twenty hours apart in the session, a few seconds apart in the replay; the replay closes the turn at the end.
      expect(office.state.activity.map((a) => a.text)).toEqual(['first prompt', 'try again', 'Done for now']);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });
});
