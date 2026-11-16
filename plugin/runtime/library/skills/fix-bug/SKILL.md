---
name: fix-bug
description: >-
  Fixes a bug at its root: reproduce it the way the user meets it, find the cause, make the smallest fix, confirm it
  the same way and add a regression test. Use for any reported bug, crash, failing check or behaviour that differs
  from what was intended.
worklings:
  kind: workflow
  department: quality
---
# Fix a bug

1. Pin down the report: what happened, what should have happened, where (page, screen, command, endpoint) and on
   which version, device, browser or data. If a missing detail would change the reproduction, ask for it now. If the
   bug exposes data or lets someone do what they shouldn't, say so first.
2. Reproduce it the way the user meets it: the same screen, command or API call with the same inputs. Write down the
   exact steps and keep the evidence (output, screenshot, log line). If it won't reproduce, say so, list what you
   tried and what you'd need; don't ship a fix for a guess.
3. Find the root cause. Follow the code path, add temporary logging, compare with a version that worked (`git log`,
   `git bisect`). State the cause in one or two sentences; if you can only describe the symptom, keep looking.
4. Write a test that fails because of the bug, at the lowest level that shows it: a unit test for logic, an
   integration or end-to-end test for wiring. Run it and watch it fail for the right reason.
5. Fix the cause with the smallest change that does it. Look for the same mistake in similar code, and fix or list
   each instance.
6. Confirm three ways: the new test passes, the project's checks pass (typecheck, lint, the full test suite), and the
   reproduction from step 2 no longer shows the bug. A green unit test alone doesn't prove the user's problem is gone.
7. Remove the temporary logging and any scratch files.
8. Bring in the studio where a fresh view helps: a reliable repro for an intermittent bug, the owner's eye on an
   unfamiliar area, a security review when the bug touched data or access. Fix small bugs yourself. The team:

{{team}}

9. Report the cause, the fix (files changed), the test that now guards it, the commands you ran with their results,
   and anything you couldn't verify, such as a real device or a production-only condition.
