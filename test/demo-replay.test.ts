// v0.8 (SPEC-v0.8.md, "The demo replay"): the recorded run put back together, played with its prompts waiting for the
// visitor, and the start form's words held to the recording.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayPlayer } from '../web/src/company/replay/player.ts';
import { RECORDED_FOLDER, RECORDED_PROMPT, replayNote } from '../web/src/company/replay/recorded.ts';
import { applyPatch, framesOf, isRecording, type Recording, shiftTimes, waitingOn, withTaps } from '../web/src/company/replay/replayModel.ts';

const raw: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'company', 'replay', 'recording.json'), 'utf8'));
if (!isRecording(raw)) throw new Error('recording.json is not a recording');
const recording: Recording = raw;

describe('the recording', () => {
  it('is the run the start form offers', () => {
    expect(recording.prompt).toBe(RECORDED_PROMPT);
    expect(recording.folder).toBe(RECORDED_FOLDER);
  });

  it('puts every frame back together into a plain job that ends with its todo list done and its helper paid', () => {
    const frames = framesOf(recording);
    expect(frames).toHaveLength(recording.frames.length);
    const last = frames.at(-1)?.snapshot.company;
    expect(last?.shape).toBe('plain');
    expect(last?.todos?.length).toBeGreaterThan(2);
    expect(last?.todos?.every((t) => t.status === 'completed')).toBe(true);
    expect(last?.helpers?.some((h) => h.costUsd > 0)).toBe(true);
    expect(last?.approvals.length).toBeGreaterThan(0);
    expect(last?.questions.some((q) => q.plainTurn && !q.answer && !q.withdrawn)).toBe(true);
  });

  it('holds no path but the made-up one', () => {
    const text = JSON.stringify(recording);
    expect(text).not.toMatch(/AppData|worklings-record/i);
    for (const m of text.matchAll(/Users[\\/]+([A-Za-z0-9_.-]+)/g)) expect(m[1]).toBe('you');
  });
});

describe('patches', () => {
  it('replace, patch objects and arrays, and drop keys', () => {
    expect(applyPatch({ a: 1, b: [1, 2, 3], c: 3 }, { o: { a: { $: 2 }, b: { a: { 1: { $: 5 } }, n: 2 } }, d: ['c'] })).toEqual({ a: 2, b: [1, 5] });
    expect(applyPatch([1], { a: { 1: { $: { x: 1 } } }, n: 2 })).toEqual([1, { x: 1 }]);
  });

  it('move times and leave the rest alone', () => {
    expect(shiftTimes({ at: 1_000_000, cost: 0.5, n: [999_999, 1_000_500] }, 10, [1_000_000, 2_000_000])).toEqual({ at: 1_000_010, cost: 0.5, n: [999_999, 1_000_510] });
  });
});

describe('the player', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops at the first permission prompt until the visitor answers, then plays to the end', () => {
    const changes = vi.fn();
    const player = new ReplayPlayer(recording, changes);
    player.start(Date.now());
    expect(player.status().state).toBe('playing');
    vi.advanceTimersByTime(60_000);
    expect(player.status().state).toBe('waiting');
    const company = player.snapshot()?.company;
    const id = company ? waitingOn(company, new Map()) : null;
    expect(id).not.toBeNull();
    const at = player.status().frame;
    vi.advanceTimersByTime(60_000);
    expect(player.status().frame).toBe(at);
    for (let i = 0; i < 10 && player.status().state !== 'done'; i++) {
      const open = player.snapshot()?.company.approvals.find((a) => !a.answer && !a.withdrawn);
      if (open) player.decide(open.id, i === 0 ? 'deny' : 'allow', false, null);
      vi.advanceTimersByTime(60_000);
    }
    expect(player.status().state).toBe('done');
    expect(player.status().deniedOnce).toBe(true);
    expect(player.snapshot()?.company.inbox).toBe(1);
  });

  it('waits again on a run played once more, with ids of its own, and holds its clock still while it waits', () => {
    const player = new ReplayPlayer(recording, () => undefined);
    player.start(Date.now());
    vi.advanceTimersByTime(60_000);
    const first = player.snapshot()?.company.approvals.find((a) => !a.answer)?.id;
    const asked = player.snapshot()?.company.approvals.find((a) => !a.answer)?.askedAt ?? 0;
    // Ten minutes on, the prompt still reads as just asked: nothing expires while the visitor thinks.
    vi.advanceTimersByTime(10 * 60_000);
    const later = player.snapshot();
    expect(player.status().state).toBe('waiting');
    expect((later?.serverTime ?? 0) - (later?.company.approvals.find((a) => a.id === first)?.askedAt ?? 0)).toBeLessThan(60_000);
    expect(later?.company.approvals.find((a) => a.id === first)?.askedAt ?? 0).toBeGreaterThan(asked);
    player.start(Date.now());
    vi.advanceTimersByTime(60_000);
    const again = player.snapshot()?.company.approvals.find((a) => !a.answer)?.id;
    expect(player.status().state).toBe('waiting');
    expect(again).not.toBe(first);
    player.stop();
  });

  it('moves the run to now and skips to the end on request', () => {
    const player = new ReplayPlayer(recording, () => undefined);
    const now = Date.now();
    player.start(now);
    expect(player.serverNow()).toBe(now);
    player.skipToEnd();
    expect(player.status()).toMatchObject({ state: 'done', frame: recording.frames.length });
    expect(player.serverNow()).toBe(now + (framesOf(recording).at(-1)?.snapshot.serverTime ?? 0) - (framesOf(recording)[0]?.snapshot.serverTime ?? 0));
  });

  it('counts what the visitor answered out of the inbox', () => {
    const last = framesOf(recording).at(-1)?.snapshot.company;
    if (!last) throw new Error('no frames');
    const q = last.questions.find((x) => x.plainTurn && !x.answer && !x.withdrawn);
    if (!q) throw new Error('no last words');
    expect(withTaps(last, new Map([[q.id, { kind: 'question', option: null, text: 'Thanks', at: 1 }]]), 5_000).inbox).toBe(0);
  });
});

describe("the demo's start form", () => {
  it('says what Start does, and that other words replay the recorded run', () => {
    expect(replayNote(RECORDED_PROMPT)).toMatch(/replays a real Claude Code run of these words/);
    expect(replayNote('A to-do app')).toMatch(/replays the recorded run of “Build haiku-check/);
    expect(replayNote('A to-do app')).toMatch(/not your words/);
  });
});

describe("the demo's plain jobs", () => {
  it('draws Recipe box as one desk with its working helper beside it', async () => {
    const { demoPlainView, demoSnapshot } = await import('../src/core/demo-company.ts');
    const view = demoPlainView(1_800_000_000_000);
    const snapshot = demoSnapshot(view, 'C:\\Users\\you\\Projects\\recipe-box', 1_800_000_000_000);
    expect(snapshot.studio?.roles.map((r) => r.title)).toEqual(['Claude Code']);
    expect(snapshot.agents.filter((a) => a.helperOf === 'builder').map((a) => a.status)).toEqual(['done', 'working']);
    expect(view.inbox).toBe(1);
  });

  it('replays the recorded run when the demo starts one Claude Code session, whatever the words', async () => {
    const { DemoHub, REPLAY_ID } = await import('../web/src/company/demo.ts');
    const hub = new DemoHub(Date.now(), () => true);
    const { id } = await hub.hub().createCompany('C:\\Users\\you\\Projects\\anything', 'A to-do app', 'plain');
    expect(id).toBe(REPLAY_ID);
    expect(hub.lobby().companies.some((c) => c.id === REPLAY_ID)).toBe(true);
    expect(hub.snapshot(REPLAY_ID)?.company.shape).toBe('plain');
    // Anything but answering what the run asks is refused in a sentence.
    await expect(hub.actions(REPLAY_ID).say('builder', 'Hello')).rejects.toThrow(/recorded run/);
    hub.replayOf(REPLAY_ID)?.stop();
  });
});
