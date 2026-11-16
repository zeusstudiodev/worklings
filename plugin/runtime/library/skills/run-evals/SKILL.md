---
name: run-evals
description: >-
  Runs the eval set for an AI feature or model against a change and compares it with the baseline: quality overall
  and per slice, case-level regressions, safety cases, cost per request and latency. Use after any change to prompts,
  models, parameters, features, retrieval or tools, and before a release.
worklings:
  kind: workflow
  department: data
---
# Run evals

1. Find the eval set and its command (an `evals/` folder, a script in the project's manifest, the docs). If there is
   none, stop and propose a minimal one first: 20 to 50 realistic and adversarial cases, how each is graded, and
   where results are recorded.
2. Find the baseline: the last recorded results for the same eval set version, with the model, prompt or config
   version and parameters behind them. If the baseline is stale or missing, run it on the base commit first.
3. Run the evals on the change with the same set, graders and settings. When outputs vary (sampling, tools,
   retrieval), run several times and report the mean and the spread.
4. Compare with the baseline: the overall score, each slice or category, and the case-level changes (newly failing,
   newly passing). Read the failing outputs themselves; graders make mistakes too.
5. Measure cost and latency: tokens or compute per case, cost per thousand requests at the provider's current prices
   (check them), p50 and p95 latency, and the rate of errors, timeouts and refusals.
6. Check the safety cases if the set has them: prompt injection, leaks of personal data or system prompts, harmful
   output, and refusals that should and shouldn't happen.
7. Never change the eval set or the graders to make a change pass. If a case is wrong, say why and fix it in a
   separate change with its own baseline.
8. Bring in the studio for a second read of the regressions or the cost picture where it helps:

{{team}}

9. Report a table of baseline against change (quality, cost, latency), the regressions with case ids and example
   outputs, and your call (better, worse or mixed) with the next step. Save the results where the project keeps
   them, with the date, commit, model and prompt or config version.
