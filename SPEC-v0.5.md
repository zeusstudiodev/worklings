# Worklings v0.5: one session, then an independent review and a fix round

Approved by the maintainer on 15 Nov 2026, after the v0.4 bench.

## Why

v0.4's harness company lost to one Claude Code session on every task (review 7.3 against 8.5) with setup and effort equal.
Its Builder aimed at the milestone's acceptance tests and the Lead's plan, and stopped once those passed; a lone
session aims at the whole request, and that is where the reviewer's points came from. The other cost was 3.5 step-ins
a run, mostly approvals asking about inline `node -e` and `python -c`.

So the company stops competing with one session and builds on it: one session, then an independent review, then one
fix round.

## The shape (`solo`, the default on this branch; `classic` and v0.4's `harness` stay selectable)

1. **Lead**: scopes the job when it needs to and writes a short plan the stakeholder approves, as now. The plan is
   advice, not a ceiling: a job one session could finish is one milestone, with no task split.
2. **Builder**: one warm session. Its first turn carries the stakeholder's words verbatim as the goal ("build all of
   this"), the plan as advice and v0.4's quality bar. It keeps the Agent tool and helpers for divisible work. No
   acceptance tests are handed to it as the target, and a single-milestone job has no per-milestone stops.
3. **Reviewer**: fresh, independent, read-only; v0.3's review that looks at the running app with screenshots and runs
   the project's own tests; ranked findings with evidence.
4. **Fix round**: the same warm Builder gets the findings, fixes what is real, and the office reruns the project's
   tests. At most one more round, for a blocker. Then the Lead's handover.
5. **No Tester seat.** The office shows the Lead, the Builder with its helpers and the Reviewer.

## Approvals

Inline `node -e` / `--eval` / `-p` and `python -c` run without asking when the code shows no write, network, process
or environment API, leaves no project path and hides nothing (eval, Function, `__import__`, exec, base64, escapes, a
module or a property named by anything but a plain literal). Everything else asks as before; when unsure, it asks.

## The bench and the ship rule

- Arm A: v0.4's neutral one-session runs, reused. Arm B: v0.5 Balanced, Sonnet, one run each: household first, then
  feature, link-checker, bookclub. Blind two-round Opus reviews against the same A outputs, kill deny rules on.
- Hard cap USD 12 for the job, reviews included; skip small tasks before household.
- Ship rule: small tasks within 0.5 of A on the review at no more than 1.5x its cost; household above A on the review
  with no hidden-test regressions.
