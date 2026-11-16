---
name: code-gate
description: >-
  Reviews a finished change before it moves on: correctness, tests, the project's rules, security basics and
  maintainability, with a pass or fail verdict. Use when a feature or fix is done and before it is merged or shipped.
worklings:
  kind: gate
  department: quality
  from: engineering
  to: quality
---
# Code gate

A change passes this gate only with evidence. Review the diff against what was asked, not against your own taste.

1. Collect the change: the diff (`git diff` against the base), the task it implements and the plan if there is one.
2. Run the project's checks: typecheck, lint, tests, and the build when configuration or dependencies changed.
   Record each command and its result.
3. Read the diff for:
   - Bugs: wrong logic, unhandled errors and edge cases, race conditions, broken states.
   - Tests: new behaviour is tested at the right level; no test was weakened, skipped or special-cased.
   - The rules in `.claude/rules/` for the paths that changed.
   - Security basics: no secrets in code, input validated at boundaries, no injection, safe auth checks.
   - Scope: no unrelated refactors, renames or dependency bumps mixed in.
4. If the studio has a code reviewer, hand them the diff and the check results for a second, independent read:

{{team}}

5. Verdict: **pass** or **fail**. For a fail, list each blocking problem with file and line, why it matters and the
   smallest fix. Separate blockers from suggestions.
