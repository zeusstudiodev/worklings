// A portfolio's hard cap (SPEC-v0.3.md, S1): when its companies together have spent its budget, every one of them
// pauses as a company does at its own budget: turns under way finish, nothing new starts. The hub holds that pause on
// each company's switchboard itself, between the company and its desks, so a company's own pauses and resumes (its
// budget, the plan's usage limit, the stakeholder's Pause) keep working underneath and come back when the hold lifts.
import type { DeskControl } from '../core/company.ts';

export interface Hold {
  /** Holds the company's desks (true) or lets them go back to what the company itself asked (false). */
  set(on: boolean): void;
  readonly on: boolean;
}

/** The switchboard as the company sees it, with the portfolio's hold on top. */
export function holdable(inner: DeskControl, now: () => number = Date.now): { control: DeskControl; hold: Hold } {
  /** What the company itself asked for last: running (null), or a pause until a time or until resumed. */
  let own: { until: number | null } | null = null;
  let held = false;
  const control: DeskControl = {
    deliver: (plan, turn) => inner.deliver(plan, turn),
    stop: (plan, turn) => inner.stop(plan, turn),
    withdraw: (id) => inner.withdraw(id),
    close: (person) => inner.close(person),
    closeAll: () => inner.closeAll(),
    desks: () => inner.desks(),
    setMaxDesks: (n) => inner.setMaxDesks(n),
    setIdleMs: (ms) => inner.setIdleMs(ms),
    pause(until) {
      own = { until };
      // While held, the switchboard stays paused with no end time: a timed rest mustn't wake it before the hold lifts.
      if (!held) inner.pause(until);
    },
    resume() {
      own = null;
      if (!held) inner.resume();
    },
  };
  const hold: Hold = {
    get on() {
      return held;
    },
    set(on) {
      if (on === held) return;
      held = on;
      if (on) {
        inner.pause(null);
        return;
      }
      if (own === null) inner.resume();
      else if (own.until !== null && own.until <= now()) {
        own = null;
        inner.resume();
      } else inner.pause(own.until);
    },
  };
  return { control, hold };
}
