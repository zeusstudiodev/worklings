---
name: fix-bug
description: "Fixes a bug at its root: reproduce it the way the user meets it, find the cause, make the smallest fix, confirm it the same way and add a regression test. Use for any reported bug, crash, failing check or behaviour that differs from what was intended."
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

- `frontend-engineer` (Frontend engineer, Engineering): Builds and fixes the web front end: pages, components, client state, forms and data fetching, responsive from phone to desktop and fast to load.
- `backend-engineer` (Backend engineer, Engineering): Builds and fixes the server side: API endpoints, data models and migrations, authentication and permission checks, background jobs, webhooks and integrations.
- `ux-designer` (UX designer, Design): Designs user flows, screen structure and interaction details with every state (first use, loading, empty, error, offline, success) decided before anything is built, then checks the built result against them.
- `qa-engineer` (QA engineer, Quality): Tests changes the way users meet them: writes and runs automated tests, drives the product end to end, reproduces bugs and reports with evidence.
- `ui-designer` (UI designer, Design): Shapes and applies the visual system: design tokens, type and spacing scales, components and all their states, hierarchy, theming and motion, with contrast checked.
- `code-reviewer` (Code reviewer, Quality): Gives an independent, read-only review of a diff against the task it implements: correctness first, then tests, the project's rules, scope and maintainability, with evidence and a clear verdict.
- `security-reviewer` (Security reviewer, Security): Reviews code and designs for security, threat model first: authentication and authorisation, input handling and injection, secrets, dependencies, SSRF and data exposure, with severity, exploit path and fix for each finding.
- `accessibility-specialist` (Accessibility specialist, Quality): Audits and fixes accessibility to WCAG 2.2 AA in practice: keyboard use, focus, screen-reader names and announcements, contrast, motion, zoom and touch targets, tested with real tools.
- `docs-writer` (Docs writer, Content): Writes and maintains READMEs, guides, API and CLI reference, changelogs and migration notes, running every command and example against the current code.

9. Report the cause, the fix (files changed), the test that now guards it, the commands you ran with their results,
   and anything you couldn't verify, such as a real device or a production-only condition.
