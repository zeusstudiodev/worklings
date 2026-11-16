import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CompanyView, mayMessage, STAKEHOLDER } from '../src/core/company.ts';
import { demoCompanyView } from '../src/core/demo-company.ts';
import { DemoHub, demoSteering } from '../web/src/company/demo.ts';
import { newMade, TALK_BEATS, TALK_KEPT, TALK_PACE, talkReady, talkStep } from '../web/src/company/demoModel.ts';

const NOW = Date.UTC(2026, 10, 5, 13, 30);
const FIRST_BEAT = TALK_PACE.first + TALK_BEATS[0]!.length * TALK_PACE.step;

describe("the café's slow talk, step by step", () => {
  const cafe = demoCompanyView(NOW);
  const ids = () => {
    let n = 0;
    return { message: () => `x-${++n}`, ack: () => `xk-${++n}` };
  };

  it('keeps to the org: everyone writes to their manager, their reports or their team, and the ones passed on come from the one before', () => {
    for (const beat of TALK_BEATS) {
      expect(talkReady(cafe, beat), 'every conversation can be played in the café').toBe(true);
      const said = new Map<string, { from: string; to: string }>();
      for (const step of beat) {
        if (step.kind === 'say' || step.kind === 'pass') {
          expect(mayMessage(cafe.people, step.from, step.to), `${step.from} to ${step.to}`).toBe(true);
          if (step.kind === 'pass') {
            const before = said.get(step.of);
            expect(before?.to, `${step.from} passes on what reached them`).toBe(step.from);
          }
          said.set(step.key, step);
        } else if (step.kind === 'ack') {
          expect(said.has(step.of)).toBe(true);
        } else {
          expect(cafe.people.some((p) => p.id === step.person)).toBe(true);
          if (step.task) expect(cafe.tasks.some((t) => t.id === step.task && t.owner === step.person), `${step.person}'s task`).toBe(true);
        }
      }
    }
  });

  it("only adds: every message, answer, decision and acknowledgement that was there stays exactly as it was", () => {
    let view: CompanyView = cafe;
    const keys = new Map<string, string>();
    const made = newMade();
    for (const step of TALK_BEATS[0] ?? []) view = talkStep(view, step, keys, made, ids(), NOW + 1_000);
    expect(view.messages.slice(0, cafe.messages.length)).toEqual(cafe.messages);
    expect(view.questions).toBe(cafe.questions);
    expect(view.approvals).toBe(cafe.approvals);
    expect(view.steering?.decisions).toBe(cafe.steering?.decisions);
    expect(view.steering?.plan).toBe(cafe.steering?.plan);
    expect(view.steering?.acks.slice(0, cafe.steering?.acks.length)).toEqual(cafe.steering?.acks);
    expect(view.people.filter((p, i) => p !== cafe.people[i]).map((p) => p.id)).toEqual(['frontend-engineer']);
    expect(view.messages.length - cafe.messages.length).toBe(made.messages.length);
  });
});

describe("the café's slow talk in the demo", () => {
  let hub: DemoHub;
  let still = false;
  const view = (): CompanyView => {
    const v = hub.snapshot('demo')?.company;
    if (!v) throw new Error('the café is gone');
    return v;
  };
  const talk = () => view().messages.filter((m) => m.id.startsWith('dm-') && m.from !== STAKEHOLDER && m.to !== STAKEHOLDER && !m.id.startsWith('dm-0'));

  beforeEach(() => {
    still = false;
    vi.useFakeTimers({ now: NOW });
    hub = new DemoHub(Date.now(), () => still);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says nothing for the first twenty seconds, then plays a relay down the org one step at a time', () => {
    const before = view().messages.length;
    vi.advanceTimersByTime(TALK_PACE.first - 500);
    expect(view().messages).toHaveLength(before);
    vi.advanceTimersByTime(600);
    expect(view().messages).toHaveLength(before + 1);
    vi.advanceTimersByTime(TALK_PACE.step);
    expect(view().messages).toHaveLength(before + 2);
    vi.advanceTimersByTime(TALK_PACE.step);
    const [a, b, c] = view().messages.slice(before);
    expect([a?.from, a?.to]).toEqual(['ceo', 'head-of-engineering']);
    expect([b?.from, b?.to, b?.relayOf, b?.origin]).toEqual(['head-of-engineering', 'web-lead', a?.id, 'ceo']);
    expect([c?.from, c?.to, c?.relayOf, c?.origin, c?.text]).toEqual(['web-lead', 'frontend-engineer', b?.id, 'ceo', a?.text]);
    expect(b?.note).toBe('For the slot picker, please.');
  });

  it('then has the last one acknowledge, and moves their status line', () => {
    vi.advanceTimersByTime(FIRST_BEAT);
    const v = view();
    const last = v.messages.at(-1);
    const acks = v.steering?.acks.filter((k) => k.id.startsWith('dk-')) ?? [];
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ message: last?.id, by: 'frontend-engineer', agree: true });
    const kai = v.people.find((p) => p.id === 'frontend-engineer');
    expect(kai?.status?.text).toBe('Showing only the pickup windows with room left.');
    expect(v.statuses.at(-1)).toEqual(kai?.status);
  });

  it('plays the conversations in the same order every time, and round again', () => {
    vi.advanceTimersByTime(TALK_PACE.first + 60 * 60_000);
    const firsts = talk().filter((m) => m.relayOf === null && (m.cites ?? []).length === 0).map((m) => m.text);
    expect(firsts).toHaveLength(TALK_KEPT);
    const script = TALK_BEATS.map((b) => b.flatMap((s) => (s.kind === 'say' && s.re === undefined ? [s.text] : []))).flat();
    // The oldest conversations have left the feed, so the ones that stay run on from wherever they start.
    const start = script.indexOf(firsts[0] ?? '');
    expect(start).toBeGreaterThanOrEqual(0);
    firsts.forEach((text, i) => expect(text).toBe(script[(start + i) % script.length]));
  });

  it('keeps only the last few conversations, so an hour of talk never fills the feed', () => {
    const before = view().messages.length;
    vi.advanceTimersByTime(TALK_PACE.first + 3 * 60 * 60_000);
    const perBeat = Math.max(...TALK_BEATS.map((b) => b.filter((s) => s.kind === 'say' || s.kind === 'pass').length));
    expect(view().messages.length - before).toBeLessThanOrEqual(TALK_KEPT * perBeat);
    const kept = new Set(view().messages.map((m) => m.id));
    for (const k of view().steering?.acks ?? []) expect(kept.has(k.message), `${k.id} points at a message that is still there`).toBe(true);
  });

  it('leaves what you did as it is: your message, your answer and its reply stay while the café talks on', async () => {
    const steer = demoSteering('demo', hub);
    const sent = await hub.actions('demo').say('head-of-design', 'Please keep the menu page calm.');
    await hub.actions('demo').answer('q-3', 1, '');
    vi.advanceTimersByTime(60_000);
    const v = view();
    expect(v.messages.find((m) => m.id === sent.id)).toMatchObject({ from: STAKEHOLDER, to: 'head-of-design', text: 'Please keep the menu page calm.' });
    expect(v.messages.some((m) => m.from === 'head-of-design' && m.to === STAKEHOLDER)).toBe(true);
    expect(v.questions.find((q) => q.id === 'q-3')?.answer).toMatchObject({ option: 1 });
    expect(steer).toBeDefined();
    vi.advanceTimersByTime(30 * 60_000);
    expect(view().messages.find((m) => m.id === sent.id)?.text).toBe('Please keep the menu page calm.');
    expect(view().questions.find((q) => q.id === 'q-3')?.answer).toMatchObject({ option: 1 });
    expect(talk().length).toBeGreaterThan(0);
  });

  it('stops while the office is still, and goes on when it moves again', () => {
    still = true;
    const before = view().messages.length;
    vi.advanceTimersByTime(10 * 60_000);
    expect(view().messages).toHaveLength(before);
    still = false;
    vi.advanceTimersByTime(TALK_PACE.between + FIRST_BEAT);
    expect(view().messages.length).toBeGreaterThan(before);
  });

  it('waits while work is paused', async () => {
    await hub.actions('demo').pause();
    const before = view().messages.length;
    vi.advanceTimersByTime(5 * 60_000);
    expect(view().messages).toHaveLength(before);
  });
});
