---
name: eval-gate
description: >-
  Checks that a change to prompts, models, parameters, features, retrieval or tools keeps or improves quality: eval
  results against the baseline per slice, safety cases, robustness, cost and latency budgets and the integrity of the
  eval set, with a pass or fail verdict. Use before an AI or ML change is merged or released.
worklings:
  kind: gate
  department: data
  from: data
  to: quality
---
# Eval gate

An AI or ML change passes on eval evidence, not on a few good-looking examples.

1. Collect the change (the prompt diff, the model, parameter or feature changes, retrieval or tool changes), the eval
   set version and the baseline results.
2. Require evidence: results for the change on the full frozen eval set, with the same graders and settings as the
   baseline, repeated when outputs vary. If they're missing, run the evals first (the `run-evals` skill, if the
   studio has it).
3. Check:
   - Quality: overall and per-slice scores against the baseline; no slice drops beyond the agreed tolerance. Read a
     sample of the failures and of the newly passing cases.
   - Safety: prompt injection, leaks of personal data or system prompts, harmful output and refusal cases all pass.
   - Robustness: empty, very long, malformed and other-language inputs where the product supports them; structured
     outputs validate against their schema.
   - Budgets: cost per request and p95 latency stay within what the project set.
   - Integrity: the eval set and graders didn't change to fit this change, no eval case leaked into training data or
     few-shot examples, and model graders were checked against human labels.
4. Bring in the studio's AI, data and QA people where they're hired:

{{team}}

5. Verdict: **pass** or **fail**. Blockers are regressions beyond tolerance, safety failures, budget breaches or
   missing evidence, each with case ids and example outputs. Suggestions go in a separate list.
